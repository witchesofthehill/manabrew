// MSE spells 0..99 and retains digits outside that range, including ordinals.
const names=new Map(Object.entries({0:'zero',1:'one',2:'two',3:'three',4:'four',5:'five',6:'six',7:'seven',8:'eight',9:'nine',10:'ten',11:'eleven',12:'twelve',13:'thirteen',15:'fifteen',18:'eighteen',20:'twenty',30:'thirty',40:'forty',50:'fifty',80:'eighty'}).map(([n,s])=>[Number(n),s]));
const ordinals=new Map(Object.entries({1:'first',2:'second',3:'third',5:'fifth',8:'eighth',9:'ninth',11:'eleventh',12:'twelfth'}).map(([n,s])=>[Number(n),s]));
function cardinal(n){
  if(names.has(n))return names.get(n);
  if(n<0||n>=100)return String(n);
  if(n<20)return cardinal(n%10)+'teen';
  if(n%10===0)return cardinal(n/10)+'ty';
  return cardinal(Math.floor(n/10)*10)+'-'+cardinal(n%10);
}
function ordinal(n){
  if(ordinals.has(n))return ordinals.get(n);
  if(n<=0||n>=100)return n+'th';
  if(n<20)return cardinal(n)+'th';
  if(n%10===0)return cardinal(n).slice(0,-1)+'ieth';
  return cardinal(Math.floor(n/10)*10)+'-'+ordinal(n%10);
}
function integer(source){
  if(!/^[\t\n\r\f\v ]*[+-]?\d+$/.test(source))return null;
  const n=BigInt(source.trim());
  return n<-(1n<<63n)||n>=(1n<<63n)?null:n;
}
export function englishNumber(source,mode='cardinal'){
  const format=n=>mode==='ordinal'?ordinal(n):n===1&&mode==='article'?'a':n===1&&mode==='multiple'?'':cardinal(n);
  if(source.startsWith('<param-')){
    const start=source.indexOf('>')+1,end=start?source.indexOf('<',start):-1;
    const n=end>=0?integer(source.slice(start,end)):null;
    if(n!==null)return `<hint-${n===1n?1:2}>`+source.slice(0,start)+format(Number(BigInt.asIntN(32,n)))+source.slice(end);
    return '<hint-2>'+source;
  }
  const n=integer(source);
  return n===null?source:format(Number(BigInt.asIntN(32,n)));
}
