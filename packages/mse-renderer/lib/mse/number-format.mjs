import {MseError} from './document.mjs';
import {number,text} from './script-values.mjs';

// Round the exact binary64 value to decimal places, including ties-to-even.
// Multiplying a Number by 10**places first would lose the rounding boundary.
function roundedDecimal(value,places){
  if(!value)return 0n;
  const buffer=new ArrayBuffer(8),view=new DataView(buffer);view.setFloat64(0,value);
  const bits=view.getBigUint64(0),exponent=Number((bits>>52n)&2047n);
  let numerator=(bits&((1n<<52n)-1n))|(exponent?1n<<52n:0n),denominator=1n;
  const power=exponent?exponent-1075:-1074;
  if(power>=0)numerator<<=BigInt(power);else denominator<<=BigInt(-power);
  if(places>=0)numerator*=10n**BigInt(places);else denominator*=10n**BigInt(-places);
  const quotient=numerator/denominator,remainder=numerator%denominator;
  return quotient+(2n*remainder>denominator||(2n*remainder===denominator&&quotient%2n)?1n:0n);
}
function fixed(value,precision,alternate){
  const digits=String(roundedDecimal(value,precision)).padStart(precision+1,'0');
  return precision?digits.slice(0,-precision)+'.'+digits.slice(-precision):digits+(alternate?'.':'');
}
function significant(value,precision){
  let exponent=value?Math.floor(Math.log10(value)):0;
  if(value){
    if(value<10**exponent)exponent--;
    else if(value>=10**(exponent+1))exponent++;
  }
  let rounded=roundedDecimal(value,precision-1-exponent);
  if(rounded>=10n**BigInt(precision)){rounded/=10n;exponent++;}
  return {digits:String(rounded).padStart(precision,'0'),exponent};
}
const trimFraction=value=>value.includes('.')?value.replace(/0+$/,'').replace(/\.$/,''):value;
function floating(value,type,precision,alternate){
  if(!Number.isFinite(value))return Number.isNaN(value)?'nan':'inf';
  if(type==='f')return fixed(value,precision,alternate);
  const size=type==='e'?precision+1:Math.max(1,precision);
  const {digits,exponent}=significant(value,size);
  if(type==='e'||exponent<-4||exponent>=size){
    let mantissa=digits[0]+(digits.length>1?'.'+digits.slice(1):alternate?'.':'');
    if(type==='g'&&!alternate)mantissa=trimFraction(mantissa);
    return mantissa+'e'+(exponent<0?'-':'+')+String(Math.abs(exponent)).padStart(2,'0');
  }
  const point=exponent+1;
  let result=point<=0?'0.'+'0'.repeat(-point)+digits:
    point>=digits.length?digits+'0'.repeat(point-digits.length)+(alternate?'.':''):
    digits.slice(0,point)+'.'+digits.slice(point);
  return alternate?result:trimFraction(result);
}

export function formatMseNumberOrText(value,format){
  // Native prepends one percent and removes all percent signs from the input.
  const match=/^([-+ #0]*)(\d*)(?:\.(\d*))?([dioxXfFeEgGsS])(.*)$/s.exec(format.replaceAll('%',''));
  if(!match)throw new MseError('script-format',`Unsupported format ${format}`);
  const [,flags,widthText,precisionText,conversion,suffix]=match;
  const width=Number(widthText||0),precision=precisionText===undefined?undefined:Number(precisionText||0);
  if(width>1000000||precision>10000)throw new MseError('script-format','Format exceeds output resource limit');
  const type=conversion.toLowerCase(),alternate=flags.includes('#'),left=flags.includes('-');
  let output,prefix='',zero=flags.includes('0')&&!left;
  if(type==='s'){
    output=[...text(value)].slice(0,precision).join('');zero=false;
  }else if(['d','i','o','x'].includes(type)){
    const integer=number(value,true)|0,unsigned=type==='o'||type==='x',magnitude=unsigned?integer>>>0:Math.abs(integer);
    output=magnitude===0&&precision===0?'':magnitude.toString(type==='o'?8:type==='x'?16:10);
    output=output.padStart(precision??0,'0');
    if(unsigned){
      if(alternate&&type==='x'&&magnitude)prefix='0x';
      if(alternate&&type==='o'&&!output.startsWith('0'))output='0'+output;
    }else prefix=integer<0?'-':flags.includes('+')?'+':flags.includes(' ')?' ':'';
    if(precision!==undefined)zero=false;
  }else{
    const input=number(value);prefix=input<0||Object.is(input,-0)?'-':flags.includes('+')?'+':flags.includes(' ')?' ':'';
    output=floating(Math.abs(input),type,precision??6,alternate);
    if(!Number.isFinite(input))zero=false;
  }
  if(type!=='s'&&conversion===conversion.toUpperCase()){output=output.toUpperCase();prefix=prefix.toUpperCase();}
  const padding=Math.max(0,width-[...prefix+output].length);
  return (left?prefix+output+' '.repeat(padding):zero?prefix+'0'.repeat(padding)+output:' '.repeat(padding)+prefix+output)+suffix;
}
