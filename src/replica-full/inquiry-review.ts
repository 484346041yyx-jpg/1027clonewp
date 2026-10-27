import { z } from 'zod';
import { parse } from 'parse5';
import sharp from 'sharp';
import { native44Id } from '../native44/adapters.js';
import { walkNative44, type Native44Program } from '../native44/types.js';
import type { FullReplicaBoundCheckpoint, FullReplicaManifest, FullReplicaReview } from './types.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/), ref = z.object({path:z.string().min(1),sha256:hash}).strict();
const marker = z.string().regex(/^clonewp-inquiry-test-[a-f0-9]{32}$/);
const fieldHashes = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,49}$/),hash);
export const inquirySubmissionQuerySchema = z.object({pageId:z.number().int().positive(),runId:z.string().regex(/^[A-Za-z0-9_-]{4,100}$/),elementId:z.string().regex(/^[a-f0-9]{7}$/),submissionId:z.number().int().positive().optional(),testMarker:marker}).strict();
export type InquirySubmissionQuery = z.infer<typeof inquirySubmissionQuerySchema>;
export const inquiryBackendObservationSchema = inquirySubmissionQuerySchema.extend({
  submissionId:z.number().int().positive(),
  observedAt:z.iso.datetime(),createdAt:z.iso.datetime(),fieldHashes,markerMatches:z.literal(1),emailAction:z.enum(['success','failed','pending']),
}).strict();
export type InquiryBackendObservation = z.infer<typeof inquiryBackendObservationSchema>;
export type InquiryBackendReader = (query:InquirySubmissionQuery)=>Promise<InquiryBackendObservation>;
export function inquirySubmissionReviewRequired(program:Native44Program,evidence:unknown):boolean{
  return program.inquiryPolicy?.testing!=='user-managed'||evidence!==undefined;
}
export function assertInquiryElement(program:Native44Program,elementId:string):void {
  if(!walkNative44(program.blocks).some(node=>node.kind==='native'&&node.pendingForm?.version===4&&native44Id(program.taskId,node.key)===elementId))fail('unowned_form');
}
const formTestSchema = z.object({
  componentKey:z.string().min(1),elementId:z.string().regex(/^[a-f0-9]{7}$/),submissionId:z.number().int().positive(),testMarker:marker,
  observedAt:z.iso.datetime(),fieldHashes,request:ref,success:ref,
  validation:z.array(z.object({case:z.enum(['required','email']),evidence:ref}).strict()).max(2),
  mailboxReceipt:ref.optional(),
}).strict();
const browserIdentity={pageId:z.number().int().positive(),elementId:z.string().regex(/^[a-f0-9]{7}$/),fingerprint:hash,testMarker:marker,observedAt:z.iso.datetime()};
const requestSchema=z.object({...browserIdentity,kind:z.literal('clonewp-inquiry-request'),url:z.url(),method:z.literal('POST'),action:z.literal('elementor_pro_forms_send_form'),status:z.literal(200),responseSuccess:z.literal(true),fieldHashes}).strict();
const successSchema=z.object({...browserIdentity,kind:z.literal('clonewp-inquiry-success'),successVisible:z.literal(true),message:z.string().trim().min(1),html:z.string().min(1).max(12*1024*1024),screenshot:ref}).strict();
const validationSchema=z.object({...browserIdentity,kind:z.literal('clonewp-inquiry-validation'),case:z.enum(['required','email']),rejected:z.literal(true),submissionRequests:z.literal(0),invalidFieldIds:z.array(z.string().min(1)).min(1).max(30),screenshot:ref}).strict();
export const inquiryReviewSchema = z.object({version:z.literal(1),kind:z.literal('clonewp-inquiry-review'),pageId:z.number().int().positive(),fingerprint:hash,forms:z.array(formTestSchema).min(1).max(100)}).strict();
type Read = (reference:{path:string;sha256:string},base?:string)=>Promise<{filename:string;bytes:Buffer}>;
function fail(reason:string):never{throw Error(`replica_full_inquiry_review_${reason}`);}
const same = (a:Record<string,string>,b:Record<string,string>)=>JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());
function fresh(time:string,review:FullReplicaReview):void {const age=Date.parse(review.observedAt)-Date.parse(time);if(!Number.isFinite(age)||age<0||age>3600000)fail('stale_observation');}
export async function verifyInquiryReview(input:{program:Native44Program;manifest:FullReplicaManifest;bound:FullReplicaBoundCheckpoint;review:FullReplicaReview;evidence:unknown;base:string;read:Read;backend?:InquiryBackendReader}):Promise<void>{
  const nodes=walkNative44(input.program.blocks).filter(node=>node.kind==='native'&&node.pendingForm?.version===4);
  if(!nodes.length){if(input.evidence!==undefined)fail('unexpected_evidence');return;}
  const evidence=inquiryReviewSchema.parse(input.evidence);
  if(evidence.pageId!==input.bound.pageId||evidence.fingerprint!==input.review.fingerprint||evidence.forms.length!==nodes.length||new Set(evidence.forms.map(row=>row.componentKey)).size!==nodes.length||new Set(evidence.forms.map(row=>row.testMarker)).size!==nodes.length)fail('identity_or_coverage');
  if(!input.backend)fail('fresh_backend_reader_required');
  const read=async(reference:z.infer<typeof ref>)=>JSON.parse((await input.read(reference,input.base)).bytes.toString('utf8'));
  const screenshot=async(reference:unknown)=>{const file=await input.read(ref.parse(reference),input.base),size=await sharp(file.bytes).metadata();if(!size.width||!size.height||size.width<300||size.height<150)fail('screenshot_invalid');};
  for(const node of nodes){
    if(node.kind!=='native'||node.pendingForm?.version!==4)fail('form_contract');
    const test=evidence.forms.find(row=>row.componentKey===node.key),elementId=native44Id(input.program.taskId,node.key);
    if(!test||test.elementId!==elementId)fail('form_owner');fresh(test.observedAt,input.review);
    const request=requestSchema.parse(await read(test.request)),success=successSchema.parse(await read(test.success));
    for(const record of [request,success]){if(record.pageId!==input.bound.pageId||record.elementId!==elementId||record.fingerprint!==input.review.fingerprint||record.testMarker!==test.testMarker)fail('browser_identity');fresh(record.observedAt,input.review);}
    const url=new URL(request.url);
    if(url.origin!==input.manifest.targetOrigin||url.pathname!=='/wp-admin/admin-ajax.php'||url.search||url.hash||url.username||url.password||!same(request.fieldHashes,test.fieldHashes))fail('native_request');
    if(success.kind!=='clonewp-inquiry-success'||success.successVisible!==true||typeof success.html!=='string'||!success.screenshot||typeof success.message!=='string'||!success.message.trim())fail('success_feedback');
    const all:any[]=[];const visit=(n:any)=>{all.push(n);for(const child of n.childNodes??[])visit(child);};visit(parse(success.html));
    const attributes=(n:any)=>Object.fromEntries((n.attrs??[]).map((a:any)=>[a.name,a.value]));
    const messages=all.filter(n=>String(attributes(n).class??'').split(/\s+/).includes('elementor-message-success'));
    if(messages.length!==1||all.some(n=>n.tagName==='script')||success.message!==node.widgetSettings.success_message)fail('native_success_dom');
    const text=(n:any):string=>n.nodeName==='#text'?String(n.value):(n.childNodes??[]).map(text).join('');
    if(text(messages[0]).replace(/\s+/g,' ').trim()!==success.message.replace(/\s+/g,' ').trim())fail('success_message_mismatch');
    let ancestor=messages[0].parentNode,widget=false,root=false;
    while(ancestor){const attrs=attributes(ancestor);if(attrs['data-widget_type']){if(widget||attrs['data-id']!==elementId||attrs['data-widget_type']!=='form.default')fail('success_widget_owner');widget=true;}if(attrs['data-elementor-id']){if(attrs['data-elementor-id']!==String(input.bound.pageId))fail('success_page_owner');root=true;break;}ancestor=ancestor.parentNode;}
    if(!widget||!root)fail('success_owner');
    await screenshot(success.screenshot);
    const fields=node.widgetSettings.form_fields as any[];
    const needed=[...(fields.some(field=>field.required==='true')?['required']:[]),...(fields.some(field=>field.field_type==='email')?['email']:[])];
    if(test.validation.length!==needed.length||new Set(test.validation.map(row=>row.case)).size!==needed.length||needed.some(name=>!test.validation.some(row=>row.case===name)))fail('validation_coverage');
    for(const check of test.validation){const record=validationSchema.parse(await read(check.evidence));if(record.pageId!==input.bound.pageId||record.elementId!==elementId||record.fingerprint!==input.review.fingerprint||record.testMarker!==test.testMarker||record.case!==check.case||record.invalidFieldIds.some((id:string)=>!fields.some(field=>field.custom_id===id&&(check.case==='required'?field.required==='true':field.field_type==='email'))))fail('validation_failed');fresh(record.observedAt,input.review);await screenshot(record.screenshot);}
    const backend=inquiryBackendObservationSchema.parse(await input.backend({pageId:input.bound.pageId,runId:input.manifest.runId,elementId,submissionId:test.submissionId,testMarker:test.testMarker}));
    if(backend.emailAction!=='success')fail('email_not_accepted');
    if(backend.pageId!==input.bound.pageId||backend.runId!==input.manifest.runId||backend.elementId!==elementId||backend.submissionId!==test.submissionId||backend.testMarker!==test.testMarker||!same(backend.fieldHashes,test.fieldHashes))fail('backend_mismatch');if(Math.abs(Date.now()-Date.parse(backend.observedAt))>300000)fail('backend_observation_not_current');fresh(backend.createdAt,input.review);
    const ids=(node.widgetSettings.form_fields as any[]).map(field=>field.custom_id).sort();if(JSON.stringify(ids)!==JSON.stringify(Object.keys(test.fieldHashes).sort()))fail('stored_field_coverage');
    // An Elementor email success log proves wp_mail accepted the message, not inbox delivery.
    if(test.mailboxReceipt){const receipt=await read(test.mailboxReceipt);if(receipt.kind!=='clonewp-inquiry-mailbox-receipt'||receipt.pageId!==input.bound.pageId||receipt.elementId!==elementId||receipt.testMarker!==test.testMarker||receipt.received!==true||!receipt.providerMessageId)fail('mailbox_receipt');fresh(receipt.observedAt,input.review);}
  }
}

/** Fixed read-only adapter; only one owned test submission, no field values leave PHP. */
export function inquirySubmissionReadPHP(raw:InquirySubmissionQuery):string{
  const query=inquirySubmissionQuerySchema.parse(raw),encoded=Buffer.from(JSON.stringify(query)).toString('base64');
  return `$i=json_decode(base64_decode('${encoded}'),true);try{global $wpdb;
if(!current_user_can('edit_post',$i['pageId'])||get_post_meta($i['pageId'],'_clonewp_run_id',true)!==$i['runId'])throw new RuntimeException('inquiry_owner');
if(!class_exists('ElementorPro\\Modules\\Forms\\Submissions\\Database\\Query'))throw new RuntimeException('inquiry_native_database_unavailable');
$q=\\ElementorPro\\Modules\\Forms\\Submissions\\Database\\Query::get_instance();$s=$q->get_table_submissions();$v=$q->get_table_submissions_values();$a=$q->get_table_form_actions_log();
$ids=$wpdb->get_col($wpdb->prepare("SELECT DISTINCT s.id FROM $s s INNER JOIN $v v ON v.submission_id=s.id WHERE s.post_id=%d AND s.element_id=%s AND v.value LIKE %s LIMIT 2",$i['pageId'],$i['elementId'],'%'.$wpdb->esc_like($i['testMarker']).'%'));if(count($ids)!==1||isset($i['submissionId'])&&(int)$i['submissionId']!==(int)$ids[0])throw new RuntimeException('inquiry_marker_not_unique');$i['submissionId']=(int)$ids[0];
$row=$wpdb->get_row($wpdb->prepare("SELECT id,post_id,element_id,created_at_gmt FROM $s WHERE id=%d AND post_id=%d AND element_id=%s",$i['submissionId'],$i['pageId'],$i['elementId']),ARRAY_A);if(!$row)throw new RuntimeException('inquiry_submission_missing');
$values=$wpdb->get_results($wpdb->prepare("SELECT \`key\`,value FROM $v WHERE submission_id=%d",$i['submissionId']),ARRAY_A);$hashes=[];$hasMarker=false;foreach($values as $value){if(array_key_exists($value['key'],$hashes))throw new RuntimeException('inquiry_duplicate_field');$hashes[$value['key']]=hash('sha256',(string)$value['value']);if(str_contains((string)$value['value'],$i['testMarker']))$hasMarker=true;}if(!$hasMarker)throw new RuntimeException('inquiry_marker_missing');
$count=(int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(DISTINCT s.id) FROM $s s INNER JOIN $v v ON v.submission_id=s.id WHERE s.post_id=%d AND s.element_id=%s AND v.value LIKE %s",$i['pageId'],$i['elementId'],'%'.$wpdb->esc_like($i['testMarker']).'%'));if($count!==1)throw new RuntimeException('inquiry_duplicate_submission');
$logs=$wpdb->get_results($wpdb->prepare("SELECT action_name,status FROM $a WHERE submission_id=%d",$i['submissionId']),ARRAY_A);$emailStatus=count($logs)===1&&$logs[0]['action_name']==='email'&&in_array($logs[0]['status'],['success','failed'],true)?$logs[0]['status']:'pending';
echo wp_json_encode(['ok'=>true,'value'=>array_merge($i,['observedAt'=>gmdate('Y-m-d\\TH:i:s\\Z'),'createdAt'=>str_replace(' ','T',$row['created_at_gmt']).'Z','fieldHashes'=>$hashes,'markerMatches'=>$count,'emailAction'=>$emailStatus])]);
}catch(\\Throwable $e){echo wp_json_encode(['ok'=>false,'code'=>'inquiry_submission_unconfirmed']);}`;
}
