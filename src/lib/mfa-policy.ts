export function mfaNeeded(required:boolean,currentLevel:string|null,nextLevel:string|null){
 return currentLevel!=='aal2'&&(required||nextLevel==='aal2');
}
