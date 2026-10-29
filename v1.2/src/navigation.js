export const PAGES = {
  guide:{title:'这周，你想改善什么？',description:'',controls:false},
  decision:{title:'比较两种安排',description:'',controls:true},
  demo:{title:'先看几个例子',description:'',controls:false},
  marginal:{title:'多花一小时，值不值？',description:'',controls:true},
  systems:{title:'我的当前状态',description:'',controls:true},
  evidence:{title:'这些估计稳不稳？',description:'',controls:true},
  model:{title:'底层模型',description:'变量定义、方程、机制参数与个人价值权重。',controls:true},
  files:{title:'保存与导出',description:'',controls:false}
};

export function resolvePage(hash=''){
  const key=hash.replace(/^#/,'');
  const aliases={summary:'decision',relations:'model',purpose:'model',emotion:'systems'};
  return Object.hasOwn(PAGES,key)?key:Object.hasOwn(aliases,key)?aliases[key]:'guide';
}
