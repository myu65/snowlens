import {NextResponse} from 'next/server';
import {loadState,mutateState} from '@/lib/provider';
export const dynamic='force-dynamic';
export async function GET(){try{return NextResponse.json(await loadState(),{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'保存領域を読み込めません。APP.METADATAの設定を確認してください。'},{status:403});}}
export async function POST(req:Request){try{const origin=req.headers.get('origin');if(origin&&new URL(origin).host!==req.headers.get('host'))throw Error('Invalid origin');const body=await req.json();if(!['dataset','saved','favorite','recent'].includes(body.kind))throw Error('Invalid action');return NextResponse.json(await mutateState(body),{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'保存できません。入力内容と保存先の権限を確認してください。'},{status:400});}}
