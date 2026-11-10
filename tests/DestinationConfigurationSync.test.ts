import {AgentLensError} from "../src/core/errors";
import {expect,it,vi} from "vitest";
import {syncDestinations} from "../src/runtime/DestinationConfigurationSync";
import {PluginStateStore} from "../src/runtime/PluginStateStore";
import type {AgentLensApiPort} from "../src/workbench/ports";
function fixture() {
  let disk: unknown; let failing = false;
  const store = new PluginStateStore({loadData:async()=>structuredClone(disk),saveData:async data=>{if(failing)throw Error("disk");disk=structuredClone(data);}},()=>"host");
  const target = {targetId:"vault",name:"Research",healthy:true,writable:true,folders:[{id:"vault:",path:""}]};
  const binding = {bindingId:"binding",followId:"follow",installationId:"host",targetId:"vault",saveFolderId:"vault:",saveFolderPath:"",noteTemplateId:"default",mediaPolicy:"download_all",bindingVersion:"v1",configurationState:"pending"};
  const api = {registerDestination:vi.fn().mockResolvedValue({}),pendingDestinations:vi.fn().mockResolvedValue([binding]),
    listCreators:vi.fn().mockResolvedValue([{...binding,creatorId:"binding"}]),adoptDestination:vi.fn().mockImplementation(async()=>{
      expect((await store.load()).destinationConfigurations?.[JSON.stringify(["owner","host","vault"]) ]?.[0]).toEqual(binding);
    })};
  return {store,target,binding,api,port:api as unknown as AgentLensApiPort,fail:()=>{failing=true;}};
}
it("persists native root configuration before acknowledgment without source calls",async()=>{
  const f=fixture();await syncDestinations(f.port,f.store,"owner","token",async()=>f.target,async()=>true);
  expect(f.api.adoptDestination).toHaveBeenCalledOnce();
  expect(f.api.registerDestination).toHaveBeenCalledWith("token",expect.objectContaining({folders:[{id:"vault:",path:""}]}));
});
it("does not acknowledge on disk failure, directory deletion or session change",async()=>{
  const f=fixture();await f.store.load();f.fail();
  await expect(syncDestinations(f.port,f.store,"owner","token",async()=>f.target,async()=>true)).rejects.toThrow("disk");
  expect(f.api.adoptDestination).not.toHaveBeenCalled();
  const deleted=fixture();deleted.target.folders=[];
  await syncDestinations(deleted.port,deleted.store,"owner","token",async()=>deleted.target,async()=>true);
  expect(deleted.api.adoptDestination).not.toHaveBeenCalled();
  const changed=fixture();let active=true;changed.api.pendingDestinations.mockImplementation(async()=>{active=false;return [changed.binding];});
  await expect(syncDestinations(changed.port,changed.store,"owner","token",async()=>changed.target,async()=>active)).rejects.toThrow("changed");
  expect(changed.api.adoptDestination).not.toHaveBeenCalled();
});
it("does not adopt another host or a stale destination snapshot",async()=>{
  const f=fixture();f.api.listCreators.mockResolvedValue([{...f.binding,creatorId:"binding",saveFolderPath:"Other"}]);
  await syncDestinations(f.port,f.store,"owner","token",async()=>f.target,async()=>true);
  expect(f.api.adoptDestination).not.toHaveBeenCalled();
});

it("defers failed catalog publication without adoption and retries on the next pass", async () => {
  const f=fixture();
  f.api.registerDestination.mockRejectedValueOnce(new AgentLensError("provider_unavailable", "catalog", true, 500));
  await syncDestinations(f.port,f.store,"owner","token",async()=>f.target,async()=>true);
  expect(f.api.pendingDestinations).not.toHaveBeenCalled();
  expect(f.api.adoptDestination).not.toHaveBeenCalled();
  expect((await f.store.load()).destinationConfigurations ?? {}).toEqual({});
  await syncDestinations(f.port,f.store,"owner","token",async()=>f.target,async()=>true);
  expect(f.api.adoptDestination).toHaveBeenCalledOnce();
});
it.each([401,403])("does not suppress catalog authorization failure %s", async status => {
  const f=fixture();const error=new AgentLensError(status===401?"auth_required":"forbidden","denied",false,status);
  f.api.registerDestination.mockRejectedValue(error);
  await expect(syncDestinations(f.port,f.store,"owner","token",async()=>f.target,async()=>true)).rejects.toBe(error);
});
it("does not suppress a Vault switch during failed publication or a pending-config read failure", async () => {
  const f=fixture();let active=true;
  f.api.registerDestination.mockImplementation(async()=>{active=false;throw Error("network");});
  await expect(syncDestinations(f.port,f.store,"owner","token",async()=>f.target,async()=>active)).rejects.toThrow("changed");
  const g=fixture();g.api.pendingDestinations.mockRejectedValue(Error("pending configuration"));
  await expect(syncDestinations(g.port,g.store,"owner","token",async()=>g.target,async()=>true)).rejects.toThrow("pending configuration");
  expect(g.api.adoptDestination).not.toHaveBeenCalled();
});
it("adopts a saved configuration before an execution creator exists", async () => {
  const f=fixture();const draft={...f.binding,recordType:"configuration",activationState:"waiting_platform"};
  f.api.pendingDestinations.mockResolvedValue([draft]);f.api.listCreators.mockResolvedValue([]);
  f.api.adoptDestination.mockImplementation(async()=>{
    expect(Object.values((await f.store.load()).destinationConfigurations??{}).flat()).toContainEqual(draft);
  });
  await syncDestinations(f.port,f.store,"owner","token",async()=>f.target,async()=>true);
  expect(f.api.adoptDestination).toHaveBeenCalledExactlyOnceWith("token",draft);
});
it.each(["installationId", "targetId", "saveFolderId", "saveFolderPath"])("rejects a configuration with a different %s", async field => {
  const f=fixture();const draft={...f.binding,recordType:"configuration",[field]:"elsewhere"};
  f.api.pendingDestinations.mockResolvedValue([draft]);f.api.listCreators.mockResolvedValue([]);
  await syncDestinations(f.port,f.store,"owner","token",async()=>f.target,async()=>true);
  expect(f.api.adoptDestination).not.toHaveBeenCalled();
});
