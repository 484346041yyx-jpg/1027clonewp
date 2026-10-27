import type {Page} from 'playwright';
/** Bounded retry of the exact authorized read-only preview; never infer success from a stale DOM. */
export async function navigateOwnedPreview(page:Page,url:string):Promise<{attempts:number,status:number|null}>{
 const expected=new URL(url);if(!['https:','http:'].includes(expected.protocol)||expected.username||expected.password)throw Error('Owned preview URL is invalid');
 for(let attempt=1;attempt<=2;attempt++){
  try{const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});const actual=new URL(page.url());if(actual.origin!==expected.origin||/wp-login\.php/.test(actual.pathname)||response&&response.status()>=400)throw Error('Owned preview did not reach its authorized page');return{attempts:attempt,status:response?.status()??null};}
  catch{if(attempt===2)throw Error('Owned native query frontend navigation failed after bounded same-URL retry');await page.waitForTimeout(250);}
 }
 throw Error('Owned preview navigation did not finish');
}

