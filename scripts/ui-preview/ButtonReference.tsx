// Only specimen placement lives here; buttons use the workbench's production CSS.
export function ButtonReference() {
 return <section className="agentlens-workbench" aria-label="Button state reference" style={{width:435,height:164,minHeight:164,position:'relative',background:'#e9e9e9'}}>
  <div className="agentlens-workbench__body" style={{padding:0}}>
   {[false,true].flatMap(secondary=>[0,1,2,3].map(state=><div key={`${secondary}-${state}`} className="agentlens-dialog-actions" style={{position:'absolute',left:[24,135,238,341][state],top:secondary?94:state===1?26:24,padding:0,margin:0,height:32}}>
    <button id={`specimen-${secondary?'secondary':'primary'}-${state}`} type="button" className={secondary?undefined:'mod-cta'} disabled={state===3} style={{width:82,minWidth:82,flex:'0 0 82px'}}>Action</button>
   </div>))}
  </div>
 </section>;
}
