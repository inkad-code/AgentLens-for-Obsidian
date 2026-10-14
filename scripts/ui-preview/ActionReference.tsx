import { ActionStateIcon } from '../../src/ui/workbench/ActionStateIcon';

// Board placement only; icon assets and pseudo-state transitions are production components.
export function ActionReference() {
 return <section className="agentlens-workbench" aria-label="Action state reference" style={{width:445,height:236,minHeight:236,position:'relative',background:'#e9e9e9'}}>
  {['default','hover','active','dis'].map((label,column)=><span key={label} style={{position:'absolute',left:[29,101,175,249][column],top:11,fontSize:14,lineHeight:'20px',color:'#000'}}>{label}</span>)}
  {(['run','play','pause','settings'] as const).flatMap((kind,row)=>[0,1,2,3].map(column=><button key={`${kind}-${column}`} id={`action-${kind}-${column}`} type="button" aria-label={`${kind} ${column}`} disabled={column===3} style={{position:'absolute',left:43+column*66,top:43+row*44,width:32,height:32,minHeight:32,padding:0,border:0,background:'transparent',boxShadow:'none'}}>
   <ActionStateIcon kind={kind} size={32} />
  </button>))}
 </section>;
}
