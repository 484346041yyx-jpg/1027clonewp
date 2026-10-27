import type { WoodMartHeaderTransport } from '../woodmart-header/transport.js';
import { responsiveFail as fail } from './contract.js';
import type { LegacySchema } from '../wordpress/types.js';
export interface ResponsiveTarget { visibility: Record<string, { type: string; return_value: string }> }
/** Read-only compatibility check before creating any page/menu/header. */
export async function assertResponsiveTarget(transport: Pick<WoodMartHeaderTransport, 'readPHP'>, mobileMaxWidth = 768): Promise<ResponsiveTarget> {
  const result: any = await transport.readPHP({ name: 'replica-responsive.target', trustedLocalCode: true, code: `
if (!class_exists('Elementor\\Plugin')) return ['ok'=>false];
$manager=\\Elementor\\Plugin::$instance->breakpoints;
if (!method_exists($manager,'get_active_breakpoints')) return ['ok'=>false];
$points=[]; foreach($manager->get_active_breakpoints() as $key=>$point) {
 if (!is_object($point)||!method_exists($point,'get_value')) return ['ok'=>false];
 $points[$key]=$point->get_value();
}
$element=\\Elementor\\Plugin::$instance->elements_manager->create_element_instance(['id'=>'abc1234','elType'=>'container','settings'=>[],'elements'=>[]]);
$controls=$element->get_controls();$visibility=[];
foreach(['hide_desktop','hide_tablet','hide_mobile'] as $key){$c=$controls[$key]??[];$visibility[$key]=['type'=>$c['type']??null,'return_value'=>$c['return_value']??null];}
return ['ok'=>true,'mobile'=>$points['mobile']??null,'tablet'=>$points['tablet']??null,'woodmart'=>wp_get_theme(get_template())->get('Version'),'mobileOptimization'=>(bool)woodmart_get_opt('mobile_optimization',0),'visibility'=>$visibility];
` });
  const version = typeof result?.woodmart === 'string' ? /^8\.(\d+)\.(\d+)$/.exec(result.woodmart) : null;
  const supportedWoodmart = version && (Number(version[1]) > 3 || Number(version[1]) === 3 && Number(version[2]) >= 4);
  if (result?.ok !== true || result.mobile !== mobileMaxWidth || result.tablet !== 1024 || !supportedWoodmart || result.mobileOptimization !== false) fail('target_breakpoints_or_theme_unverified');
  for (const name of ['desktop', 'tablet', 'mobile']) if (result.visibility?.['hide_' + name]?.type !== 'switcher' || result.visibility['hide_' + name].return_value !== 'hidden-' + name) fail('target_visibility_contract');
  return { visibility: result.visibility };
}
/** The legacy capability transport omits return_value. Extend only this new
 * workflow's container schema from the separate actual target readback. */
export function certifyResponsiveSchemas(schemas: Record<string, LegacySchema>, target?: ResponsiveTarget): Record<string, LegacySchema> {
  if (!target || Object.keys(target.visibility).length !== 3) fail('target_visibility_contract');
  const result = structuredClone(schemas), controls = result.container?.controls;
  for (const [key, field] of Object.entries(target.visibility)) {
    if (!['hide_desktop', 'hide_tablet', 'hide_mobile'].includes(key) || controls?.[key]?.type !== field.type || field.return_value !== 'hidden-' + key.slice(5)) fail('target_visibility_drift');
    controls[key].return_value = field.return_value;
  }
  return result;
}
