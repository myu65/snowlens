import type { Result } from './model';
export function exportCsv(result:Result):string {const cell=(v:unknown)=>{let s=v===null?'':String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return '\ufeff'+[result.columns.map(cell).join(','),...result.rows.map(r=>result.columns.map(c=>cell(r[c])).join(','))].join('\r\n');}
