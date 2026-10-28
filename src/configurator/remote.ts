import type { WoodMartHeaderTransport } from '../woodmart-header/transport.js';

/** Fixed read-only inspection; installing the ZIP does not itself prove registration or runtime support. */
export async function inspectConfiguratorRuntime(transport: Pick<WoodMartHeaderTransport, 'origin' | 'readPHP'>) {
  const result = await transport.readPHP<{ origin: string; registered: boolean; className: string | null; controls: Record<string, unknown>; files: Record<string, string>; version: string | null }>({
    name: 'configurator.inspect-runtime', trustedLocalCode: true,
    code: String.raw`$origin=untrailingslashit(home_url());$widget=class_exists('Elementor\\Plugin')?\Elementor\Plugin::$instance->widgets_manager->get_widget_types('clonewp_bottle_configurator'):null;$controls=$widget?$widget->get_controls():[];$path=WP_PLUGIN_DIR.'/clonewp-bottle-configurator/';$files=[];foreach(['clonewp-bottle-configurator.php','runtime.js','style.css']as$name){$file=$path.$name;if(is_file($file)&&!is_link($file))$files[$name]=hash_file('sha256',$file);}return ['origin'=>$origin,'registered'=>(bool)$widget,'className'=>$widget?get_class($widget):null,'controls'=>$controls,'files'=>$files,'version'=>is_file($path.'clonewp-bottle-configurator.php')?get_file_data($path.'clonewp-bottle-configurator.php',['Version'=>'Version'])['Version']:null];`,
  });
  if (result.origin !== transport.origin || !result.registered || result.className !== 'CloneWP_Bottle_Configurator' || !result.controls.options || !result.controls.form_widget || !result.controls.decorations || !result.controls.overlays) throw Error('configurator_registration_incomplete');
  return result;
}
