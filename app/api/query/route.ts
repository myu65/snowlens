import {NextResponse} from 'next/server';
import {runQuery} from '@/lib/provider';
import {exportCsv} from '@/lib/csv';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{if(Number(req.headers.get('content-length')||0)>100000)throw Error('Request too large');const body=await req.json();const result=await runQuery(body.query,body.datasetId,req.signal);if(body.csv)return new Response(exportCsv(result),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="snowlens.csv"','Cache-Control':'no-store'}});return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});}catch(e){const message=e instanceof Error?e.message:'';return NextResponse.json({error:/Unknown field|Invalid|Choose|Numeric|Sort|Duplicate|null operator|Source|Dataset/.test(message)?message:'クエリを実行できません。条件・権限を確認して再実行してください。'},{status:400});}}
