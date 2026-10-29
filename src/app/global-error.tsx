'use client';
export default function GlobalError({retry}:{error:unknown;retry:()=>void}){
 return <html lang="en"><body><main><h1>Shop Revenue couldn’t load</h1><p>Please try again. If the problem continues, contact support.</p><button onClick={()=>retry()}>Try again</button></main></body></html>;
}
