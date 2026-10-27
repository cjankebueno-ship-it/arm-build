// Apply the saved appearance before the page paints. This preference belongs to this device.
(function(root){
  'use strict';
  const key='trainer_floor_appearance_v1';
  let current='dark';
  const valid=value=>value==='light'||value==='dark';
  function apply(value){
    current=valid(value)?value:'dark';
    document.documentElement.dataset.theme=current;
    document.documentElement.style.colorScheme=current;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',current==='light'?'#f3f5f9':'#0b0b0c');
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content',current==='light'?'default':'black-translucent');
    document.querySelectorAll('[data-appearance]').forEach(input=>{input.checked=input.value===current;});
  }
  try{const saved=localStorage.getItem(key);if(valid(saved))current=saved;}catch{}
  apply(current);
  root.TrainerTheme={
    get:()=>current,
    set(value){
      if(!valid(value))return false;
      apply(value);
      try{localStorage.setItem(key,value);return true;}catch{return false;}
    }
  };
  root.addEventListener('storage',event=>{if(event.key===key||event.key===null)apply(event.key===null?'dark':event.newValue);});
})(window);
