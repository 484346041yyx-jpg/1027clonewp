import { z } from 'zod';
const ref=z.object({path:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const popupManifestSchema=z.object({
  version:z.literal(6),kind:z.literal('clonewp-full-replica'),preparationVersion:z.literal(8),pageScope:z.literal('popup-only'),
  taskId:z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),runId:z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),title:z.string().min(1).max(150),sourceUrl:z.literal('https://www.tomtoc.com/'),targetOrigin:z.url(),
  sourceMode:z.literal('user-screenshot-and-live-dom'),sourceEvidence:ref,sourceScreenshot:ref,
  assets:z.object({image:ref,regularFont:ref,semiboldFont:ref}).strict(),
  submission:z.object({action:z.literal('save-to-database'),authorization:z.literal('user-explicit'),testing:z.literal('user-managed')}).strict(),
  deliveryPolicy:z.literal('publish-after-review'),
}).strict().superRefine((m,c)=>{const u=new URL(m.targetOrigin);if(u.origin!==m.targetOrigin||u.protocol!=='https:'||u.username||u.password)c.addIssue({code:'custom',message:'popup_origin'});});
export type PopupManifest=z.infer<typeof popupManifestSchema>;
export const isPopupReplica=(v:unknown):v is PopupManifest=>!!v&&typeof v==='object'&&(v as any).version===6&&(v as any).pageScope==='popup-only';
