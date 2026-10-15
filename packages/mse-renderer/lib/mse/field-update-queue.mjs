import {MseError} from './document.mjs';

// SetScriptManager updates stored values in order and propagates changes through
// a FIFO queue. Reading a field records a dependency; it never evaluates it.
// Each field is updated at most once in a change transaction, including cycles.
export class MseFieldUpdateQueue {
  constructor(){this.nodes=new Map();this.observers=new Map();this.active=null;this.running=false;}
  register(key,update,{trackDependencies=true}={}){
    if(this.nodes.has(key))throw new MseError('field-update','Field is already registered');
    this.nodes.set(key,{update,trackDependencies,dependencies:new Set()});
  }
  read(key){
    if(!this.active||this.active.key===key)return;
    this.active.dependencies.add(key);
  }
  evaluate(key){
    const node=this.nodes.get(key);
    if(!node)throw new MseError('field-update','Field is not registered');
    const previous=this.active,current={key,dependencies:new Set()};
    this.active=node.trackDependencies?current:null;
    let changed;
    try{changed=Boolean(node.update());}
    finally{this.active=previous;}
    // Commit dependency changes only after successful evaluation. Failed scripts
    // retain their previous subscription so a later change can retry them.
    for(const dependency of node.dependencies)if(!current.dependencies.has(dependency))this.observers.get(dependency)?.delete(key);
    for(const dependency of current.dependencies){
      if(!this.observers.has(dependency))this.observers.set(dependency,new Set());
      this.observers.get(dependency).add(key);
    }
    node.dependencies=current.dependencies;
    return changed;
  }
  transaction(action){
    if(this.running)throw new MseError('field-update','Nested field update transaction');
    this.running=true;
    try{return action();}finally{this.running=false;this.active=null;}
  }
  initialize(order=this.nodes.keys()){
    return this.transaction(()=>{for(const key of order)this.evaluate(key);});
  }
  change(key){return this.changeMany([key]);}
  changeMany(keys){
    return this.transaction(()=>{
      const visited=new Set(keys),queue=[];
      for(const key of visited)this.evaluate(key);
      // Native updateValue always schedules dependents of the edited field,
      // even if its normalizing script does not change the supplied new value.
      for(const key of visited)queue.push(...(this.observers.get(key)||[]));
      for(let i=0;i<queue.length;i++){
        const next=queue[i];if(visited.has(next))continue;
        visited.add(next);
        if(this.evaluate(next))queue.push(...(this.observers.get(next)||[]));
      }
      return visited;
    });
  }
}
