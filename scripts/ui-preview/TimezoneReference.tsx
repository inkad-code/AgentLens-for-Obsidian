import { useState } from 'react';
import { TimezoneOptions } from '../../src/ui/workbench/TimezoneField';
import { inputChevron } from '../../src/ui/workbench/inputAssets';

const cities=['Shanghai','Hefei','Guangzhou','Shenzhen','Changsha'].map(city=>({city,zone:'Asia/Shanghai'}));
// Positions describe the Figma board; dropdowns and input styling use production code.
export function TimezoneReference(){
 const [selected,setSelected]=useState(1);
 return <section className="agentlens-workbench" aria-label="Timezone state reference" style={{width:2099,height:994,minHeight:994,position:'relative',background:'#e9e9e9'}}>
  {['默认','hover','激活'].map((label,index)=><div key={label}>
   <span style={{position:'absolute',left:20,top:[48,110,180][index],fontSize:12,lineHeight:'12px',color:'#596173'}}>{label}</span>
   <div className="agentlens-timezone-field" style={{position:'absolute',left:82,top:[36,99,168][index],width:580,margin:0}}>
    <div className="agentlens-timezone-input" id={`timezone-specimen-${index}`} style={{height:36}}><input aria-label={label} defaultValue={index===2?'He':'Asia/Shanghai'} /><button type="button" aria-label={`${label} options`} tabIndex={-1}><img src={inputChevron} width="14" height="14" alt="" /></button></div>
   </div>
  </div>)}
  {[82,708,1344].map((left,index)=><div key={left} className="agentlens-timezone-field" style={{position:'absolute',left,top:204,width:580,margin:0}}>
   <TimezoneOptions id={`timezone-board-${index}`} items={index===2?[{city:'Henan',zone:'Asia/Shanghai'},{city:'Hefei',zone:'Asia/Shanghai'}]:cities} active={index===1?selected:-1} query={index===2?'He':''} onChoose={index=>setSelected(index)} />
  </div>)}
  {['hover其中一个选项','选中其中一个选项','模糊匹配'].map((label,index)=><span key={label} style={{position:'absolute',left:[90,713,1344][index],top:527,fontSize:12,lineHeight:'12px',color:'#596173'}}>{label}</span>)}
 </section>;
}
