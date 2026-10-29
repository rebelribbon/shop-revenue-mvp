'use server';
import {z} from 'zod';
import {getIdentity} from '@/server/auth/session';
import {supabaseServer} from '@/server/auth/supabase';
import {checkAuthThrottle} from '@/domain/auth-throttle';
import {getRequestMeta} from '@/server/request';
export async function enrollAuthenticator(){
 const identity=await getIdentity();if(!identity)return {ok:false as const,message:'Sign in first.'};
 const supabase=await supabaseServer();
 const factors=await supabase.auth.mfa.listFactors();
 if(factors.error)return {ok:false as const,message:'Authenticator setup is unavailable.'};
 if(factors.data.totp.length)return {ok:false as const,message:'An authenticator is already enrolled. Enter its code.'};
 // Replacing an unfinished enrollment is safe; verified factors are never removed here.
 for(const f of factors.data.all.filter(f=>f.factor_type==='totp'&&f.status==='unverified'))await supabase.auth.mfa.unenroll({factorId:f.id});
 const {data,error}=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'Shop Revenue authenticator',issuer:'Shop Revenue'});
 if(error)return {ok:false as const,message:'Authenticator setup failed. Try again.'};
 return {ok:true as const,factorId:data.id,qrCode:data.totp.qr_code,secret:data.totp.secret};
}
export async function verifyAuthenticator(input:unknown){
 const parsed=z.object({factorId:z.uuid(),code:z.string().regex(/^\d{6}$/)}).safeParse(input);
 if(!parsed.success)return {ok:false as const,message:'Enter the six-digit code.'};
 const identity=await getIdentity();if(!identity)return {ok:false as const,message:'Sign in first.'};
 const meta=await getRequestMeta();
 try{await checkAuthThrottle('sign_in',`mfa:${identity.authSubject}`,meta.ip);}catch{return {ok:false as const,message:'Too many attempts. Try again later.'};}
 const supabase=await supabaseServer();
 const {error}=await supabase.auth.mfa.challengeAndVerify(parsed.data);
 if(error)return {ok:false as const,message:'That code did not work. Use the current code from your authenticator.'};
 return {ok:true as const,message:'Authenticator verified.'};
}
