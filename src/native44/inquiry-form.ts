import { z } from 'zod';
import { walkNative44, type Native44Program, type Native44Component } from './types.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const inquiryConfigurationSchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-inquiry-configuration'),
  targetOrigin: z.url().refine(value => new URL(value).origin === value && new URL(value).protocol === 'https:'),
  recipients: z.array(z.email()).min(1).max(10),
  fromEmail: z.email().optional(), fromName: z.string().trim().min(1).max(100).regex(/^[^<>\r\n\u0000]+$/).optional(),
  subject: z.string().trim().min(1).max(150).regex(/^[^<>\r\n\u0000\[\]]+$/).optional(),
  successMessage: z.string().trim().min(1).max(500).regex(/^[^<>\u0000]+$/).optional(),
  errorMessage: z.string().trim().min(1).max(500).regex(/^[^<>\u0000]+$/).optional(),
}).strict();
export type InquiryConfiguration = z.infer<typeof inquiryConfigurationSchema>;
export const inquirySitesSchema=z.object({version:z.literal(2),kind:z.literal('clonewp-inquiry-sites'),defaultRecipients:z.array(z.email()).min(1).max(10).optional(),sites:z.array(inquiryConfigurationSchema).max(100)}).strict().refine(value=>new Set(value.sites.map(site=>site.targetOrigin)).size===value.sites.length);
export function resolveInquiryConfiguration(input:InquiryConfiguration,sourceUrl?:string):InquiryConfiguration{
  const configuration=inquiryConfigurationSchema.parse(input),host=new URL(configuration.targetOrigin).hostname;
  const nameHost=new URL(sourceUrl??configuration.targetOrigin).hostname.replace(/^www\./,'');
  return inquiryConfigurationSchema.parse({...configuration,fromEmail:configuration.fromEmail??`noreply@${host}`,fromName:configuration.fromName??`${nameHost} inquiries`.slice(0,100)});
}
export const inquiryPolicySchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-inquiry-default'),
  mode: z.literal('submit-save-email'),
  testing: z.literal('user-managed').optional(),
  configuration: z.object({ path: z.string().min(1), sha256: hash }).strict().optional(),
  exceptions: z.array(z.object({
    componentKey: z.string().min(1), mode: z.enum(['static-user-request', 'non-inquiry']),
    authorization: z.enum(['user-explicit', 'source-classification']),
    sourceFactIds: z.array(z.string().min(1)).min(1), reason: z.string().trim().min(15).max(1000),
  }).strict()).max(100).default([]),
}).strict();
export type InquiryPolicy = z.infer<typeof inquiryPolicySchema>;
export function defaultInquiryPolicy(): InquiryPolicy {
  return { version: 1, kind: 'clonewp-inquiry-default', mode: 'submit-save-email', testing:'user-managed', exceptions: [] };
}
export const INQUIRY_ACTIONS = ['save-to-database', 'email'] as const;
export const INQUIRY_EMAIL_CONTROLS = ['email_to','email_from','email_from_name','email_subject','email_content','email_content_type','email_reply_to','form_metadata','submissions_metadata','success_message','error_message','custom_messages'] as const;
function fail(reason: string): never { throw Error(`native44_inquiry_${reason}`); }

/** The existing native-form path is upgraded before compiling the merged tree. */
export function configureInquiryBlocks(blocks: Native44Component[], policy: InquiryPolicy | undefined, configuration: InquiryConfiguration | undefined, taskId: string, sourceUrl?:string): Native44Component[] {
  const result = structuredClone(blocks);
  if (!policy) return result;
  for (const node of walkNative44(result)) {
    if (node.kind !== 'native' || node.widgetType !== 'form' || policy.exceptions.some(row => row.componentKey === node.key)) continue;
    if (!policy.configuration || !configuration) fail(`configuration_required:${node.key}`);
    if (!node.pendingForm || 'sourceSubmitModel' in node.pendingForm && node.pendingForm.sourceSubmitModel) fail(`native_source_binding_required:${node.key}`);
    const fields = structuredClone(node.widgetSettings.form_fields) as Record<string, any>[];
    const email = fields.find(field => field.field_type === 'email') ?? fields.find(field => field.field_type === 'text' && /e[-_\s]?mail|邮箱|邮件|correo|courriel/i.test(field.custom_id+' '+field.field_label+' '+field.placeholder));
    if (email) email.field_type = 'email';
    node.widgetSettings = configureInquirySettings({...node.widgetSettings,form_fields:fields}, configuration, email?.custom_id ?? '',sourceUrl);
    const previous = node.pendingForm;
    node.pendingForm = {
      version:4,kind:'native44-inquiry-form-v1',
      sourceControls:previous.version === 1 ? previous.sourceControls.map(row => ({snapshotId:row.snapshotId,fieldFactIds:[row.emailFactId],submitFactId:row.submitFactId})) : previous.sourceControls,
      appearance:previous.appearance,registered:previous.registered,knowledge:previous.knowledge,...(previous.version!==1&&previous.widthLayout?{widthLayout:previous.widthLayout}:{}),
      configuration:policy.configuration,replyToFieldId:email?.custom_id ?? '',
      decision:{policy:'submit-save-email',taskId,authorization:'project-default'},
    };
  }
  return result;
}

/** Project business settings, never source-site defaults or styling controls. */
export function configureInquirySettings(settings: Record<string, any>, input: InquiryConfiguration, replyToFieldId = '',sourceUrl?:string): Record<string, any> {
  const configuration = inquiryConfigurationSchema.parse(input);
  const result = structuredClone(settings);
  if (!Array.isArray(result.form_fields) || !result.form_fields.length) fail('fields_required');
  if (replyToFieldId && !result.form_fields.some((field: any) => field.custom_id === replyToFieldId && field.field_type === 'email')) fail('reply_to_email_field');
  if (typeof result._attributes === 'string') result._attributes = result._attributes.split(/[\r\n,]+/).filter((line: string) => !/^(?:inert|disabled|aria-disabled)\s*\|/i.test(line.trim())).join('\n');
  for(const key of INQUIRY_EMAIL_CONTROLS)delete result[key];
  Object.assign(result,inquiryBusinessSettings(configuration,replyToFieldId,sourceUrl));
  assertInquirySettings(result, configuration, replyToFieldId,sourceUrl);
  return result;
}
function inquiryBusinessSettings(configuration:InquiryConfiguration,replyToFieldId:string,sourceUrl?:string):Record<string,unknown>{
  const resolved=resolveInquiryConfiguration(configuration,sourceUrl);
  return {
    submit_actions: [...INQUIRY_ACTIONS], email_to: configuration.recipients.join(','),
    email_from: resolved.fromEmail, email_from_name: resolved.fromName,
    ...(configuration.subject?{email_subject:configuration.subject}:{}),email_content: '[all-fields]', email_content_type: 'plain',
    email_reply_to: replyToFieldId, form_metadata: [], submissions_metadata: [],
    ...(configuration.successMessage||configuration.errorMessage?{custom_messages:'yes'}:{}),
    ...(configuration.successMessage?{success_message:configuration.successMessage}:{}),
    ...(configuration.errorMessage?{error_message:configuration.errorMessage}:{}),
  };
}
export function assertInquirySettings(settings: Record<string, any>, configuration: InquiryConfiguration, replyToFieldId: string,sourceUrl?:string): void {
  const expected=inquiryBusinessSettings(configuration,replyToFieldId,sourceUrl);
  for (const [key, value] of Object.entries(expected)) if (JSON.stringify(settings[key]) !== JSON.stringify(value)) fail(`setting_${key}`);
  for(const key of INQUIRY_EMAIL_CONTROLS)if(!Object.hasOwn(expected,key)&&Object.hasOwn(settings,key))fail(`unexpected_setting_${key}`);
  for (const key of Object.keys(settings)) if (/^(?:email|webhook|redirect|mailchimp|mailerlite|activecampaign|convertkit|drip|getresponse|slack|discord|popup)(?:_|$)/i.test(key) && !Object.hasOwn(expected,key)) fail('unexpected_business_action');
  if (replyToFieldId && !settings.form_fields?.some((field: any) => field.custom_id === replyToFieldId && field.field_type === 'email')) fail('reply_to_email_field');
  if (String(settings._attributes ?? '').split(/[\r\n,]+/).some(line => /^(?:inert|disabled|aria-disabled)\s*\|/i.test(line.trim()))) fail('disabled_form');
}

/** Absent policy is a historical contract, never implicitly migrated. */
export function assertInquiryProgram(program: Native44Program): void {
  if (!program.inquiryPolicy) return;
  const policy = inquiryPolicySchema.parse(program.inquiryPolicy), nodes = walkNative44(program.blocks);
  const keys = policy.exceptions.map(row => row.componentKey);
  if (new Set(keys).size !== keys.length) fail('duplicate_exception');
  for (const exception of policy.exceptions) {
    const node = nodes.find(node => node.key === exception.componentKey);
    if (!node || exception.sourceFactIds.some(id => !node.sourceFactIds?.includes(id))) fail('exception_source_owner');
    if (exception.mode === 'static-user-request' && exception.authorization !== 'user-explicit') fail('static_requires_user_request');
    if (exception.mode === 'non-inquiry' && exception.authorization !== 'source-classification') fail('classification_required');
  }
  for (const node of nodes) {
    if(node.kind==='native'&&node.widgetType==='wd_contact_form_7'&&!policy.exceptions.some(row=>row.componentKey===node.key))fail('owned_native_inquiry_adapter_required');
    if (node.kind !== 'native' || node.widgetType !== 'form') continue;
    const exception = policy.exceptions.find(row => row.componentKey === node.key);
    if (exception) {
      if (node.pendingForm?.version === 4) fail('conflicting_exception');
      continue;
    }
    if (!policy.configuration) fail(`configuration_required:${node.key}`);
    if (node.pendingForm?.version !== 4) fail(`functional_form_required:${node.key}`);
    const declaration = node.pendingForm;
    if (declaration.decision.taskId !== program.taskId || declaration.decision.policy !== 'submit-save-email' || declaration.decision.authorization !== 'project-default') fail('decision_scope');
    if (declaration.configuration.path !== policy.configuration.path || declaration.configuration.sha256 !== policy.configuration.sha256) fail('configuration_binding');
  }
}
