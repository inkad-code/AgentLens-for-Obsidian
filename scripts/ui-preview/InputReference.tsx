import { useState } from 'react';
import { inputChevron } from '../../src/ui/workbench/inputAssets';

// Only specimen positions and state labels are reference-specific; input styles are production CSS.
export function InputReference() {
 const [typing,setTyping]=useState(false);
 return <section className="agentlens-workbench" aria-label="Input state reference" style={{width:394,height:459,minHeight:459,position:'relative',background:'#e9e9e9'}}>
  {['默认','hover','激活','正在输入','输入完成','错误'].map((label,index)=><div key={label}>
   <span style={{position:'absolute',left:20,top:48+index*59,fontSize:12,lineHeight:'12px',color:'#596173'}}>{label}</span>
   <div className="agentlens-timezone-field" style={{position:'absolute',left:82,top:36+index*59,width:280,margin:0}}>
    <div className="agentlens-timezone-input" id={`input-state-${index}`} data-editing={index===3 && typing}>
     <input aria-label={label} aria-invalid={index===5} defaultValue="2" onChange={()=>{if(index===3)setTyping(true);}} />
     <button type="button" tabIndex={-1} aria-label={`${label} options`}><img src={inputChevron} width="14" height="14" alt="" /></button>
    </div>
   </div>
  </div>)}
 </section>;
}
