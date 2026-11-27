/** Convert text and binary DXF into the common code/value stream used by the
 * geometry parser. Handles legacy Windows code pages and modern UTF-8. */
export function decodeDxf(bytes:ArrayBuffer):string {
  const input=new Uint8Array(bytes),prefix=new TextDecoder('latin1').decode(input.slice(0,128));
  if(!prefix.startsWith('AutoCAD Binary DXF')){
    if(input[0]===0xff&&input[1]===0xfe)return new TextDecoder('utf-16le').decode(input);
    if(input[0]===0xfe&&input[1]===0xff)return new TextDecoder('utf-16be').decode(input);
    const probe=new TextDecoder('latin1').decode(input.slice(0,16384));
    const version=probe.match(/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d+)/)?.[1];
    const page=probe.match(/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(?:ANSI_|DOS)(\d+)/i)?.[1];
    const codePages:Record<string,string>={'932':'shift_jis','936':'gbk','949':'euc-kr','950':'big5','874':'windows-874'};
    if(page&&(!version||Number(version)<1021))try{return new TextDecoder(codePages[page]??`windows-${page}`).decode(input);}catch{}
    try{return new TextDecoder('utf-8',{fatal:true}).decode(input);}catch{return new TextDecoder('windows-1252').decode(input);}
  }
  const marker=input.indexOf(0x1a);if(marker<0||input[marker+1]!==0)throw Error('Invalid binary DXF header.');
  const view=new DataView(bytes),lines:string[]=[];let at=marker+2,records=0;
  const legacy=at+1<input.length&&view.getUint16(at,true)>1071;
  const take=(n:number)=>{if(at+n>input.length)throw Error('Truncated binary DXF.');const start=at;at+=n;return start;};
  const string=()=>{const start=at;while(at<input.length&&input[at]!==0)at++;if(at>=input.length)throw Error('Unterminated binary DXF string.');const raw=input.slice(start,at++);try{return new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{return new TextDecoder('windows-1252').decode(raw);}};
  while(at<input.length){
    if(++records>1000000)throw Error('Binary DXF exceeds its record limit.');
    let code=legacy?input[take(1)]:view.getUint16(take(2),true);if(legacy&&code===255)code=view.getUint16(take(2),true);
    let value:string|number;
    if((code>=0&&code<=9)||code===100||code===102||code===105||(code>=300&&code<=309)||(code>=320&&code<=369)||(code>=390&&code<=399)||(code>=410&&code<=419)||(code>=430&&code<=439)||(code>=470&&code<=481)||code===999||(code>=1000&&code<=1003)||code===1005)value=string();
    else if((code>=10&&code<=59)||(code>=110&&code<=149)||(code>=210&&code<=239)||(code>=460&&code<=469)||(code>=1010&&code<=1059))value=view.getFloat64(take(8),true);
    else if((code>=60&&code<=79)||(code>=170&&code<=179)||(code>=270&&code<=289)||(code>=370&&code<=389)||(code>=400&&code<=409)||(code>=1060&&code<=1070))value=view.getInt16(take(2),true);
    else if((code>=90&&code<=99)||(code>=420&&code<=429)||(code>=440&&code<=459)||code===1071)value=view.getInt32(take(4),true);
    else if(code>=160&&code<=169)value=view.getBigInt64(take(8),true).toString();
    else if(code>=290&&code<=299)value=input[take(1)];
    else if((code>=310&&code<=319)||code===1004){const length=input[take(1)],start=take(length);value=Array.from(input.slice(start,start+length)).map(b=>b.toString(16).padStart(2,'0')).join('');}
    else throw Error(`Binary DXF group ${code} is not recognized.`);
    lines.push(String(code),String(value).replace(/\r?\n/g,'\\P'));
    if(code===0&&value==='EOF')break;
  }
  return lines.join('\n')+'\n';
}
