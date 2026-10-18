'use strict';
/* Streaming transport and an explicitly estimated progress indicator. */
const Generation = {
  percent:0, partial:'', running:false,
  mount(){
    document.body.insertAdjacentHTML('beforeend',`<dialog id="generation-dialog" dir="rtl" aria-labelledby="generation-title"><h2 id="generation-title">מכין את המסמך שלך</h2><p id="generation-stage" role="status" aria-live="polite"></p><strong id="generation-percent">0%</strong><progress id="generation-progress" max="100" value="0" aria-label="התקדמות משוערת"></progress><p class="ws-note">האחוזים משוערים. 100% יוצג רק לאחר קבלת התשובה המלאה והכנת המסמך לעריכה.</p><p id="generation-count"></p><p id="generation-error" role="alert"></p><div class="generation-actions"><button class="btn btn-outline" id="generation-close" type="button">סגירה</button><button class="btn btn-outline" id="generation-partial" type="button" hidden>הורדת טיוטה חלקית · TXT</button></div></dialog>`);
    $('#generation-dialog').addEventListener('cancel',e=>{if(this.running)e.preventDefault();});
    $('#generation-close').onclick=()=>$('#generation-dialog').close();
    $('#generation-partial').onclick=()=>Doc.download(new Blob(['טיוטה חלקית בלבד — לא הושלמה ולא נבדקה\n\n'+this.partial],{type:'text/plain;charset=utf-8'}),'incomplete-draft.txt');
  },
  start(){this.running=true;this.partial='';this.percent=0;this.started=Date.now();$('#generation-error').textContent='';$('#generation-partial').hidden=true;$('#generation-close').hidden=true;this.update(3,'מתחבר לשירות ה־AI…');$('#generation-dialog').showModal();this.timer=setInterval(()=>{if(this.percent<15)this.update(this.percent+1,'ממתין לתחילת הכתיבה…');this.count();},1500);},
  count(){const seconds=Math.floor((Date.now()-this.started)/1000);$('#generation-count').textContent=seconds+' שניות · '+this.partial.length.toLocaleString('he-IL')+' תווים התקבלו';},
  update(value,stage){this.percent=Math.max(this.percent,Math.min(100,Math.floor(value)));$('#generation-percent').textContent=this.percent+'%';$('#generation-progress').value=this.percent;$('#generation-stage').textContent=stage;this.count();},
  fail(err){clearInterval(this.timer);this.running=false;$('#generation-title').textContent='יצירת המסמך לא הושלמה';$('#generation-stage').textContent='הפרטים שהזנת נשארו בטופס.';$('#generation-error').textContent=err.message;$('#generation-close').hidden=false;$('#generation-partial').hidden=!this.partial;},
  finish(){clearInterval(this.timer);this.running=false;this.update(100,'המסמך מוכן לעריכה');$('#generation-dialog').close();},
  async readResponse(res,onProgress){
    if(!res.ok||!res.headers.get('content-type')?.includes('text/event-stream')){
      let timer;try{return await Promise.race([res.json(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('לא התקבלה תשובה מלאה בזמן. נסו שוב.')),240000);})]);}catch(err){if(err instanceof SyntaxError)throw Error('שירות ה־AI החזיר תשובה לא תקינה (HTTP '+res.status+'). נסו שוב.');throw err;}finally{clearTimeout(timer);}
    }
    if(!res.body)throw Error('הדפדפן לא קיבל גוף תשובה משירות ה־AI.');
    const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='',text='',stop=null,ended=false,usage={},streamError=null;
    const deadline=Date.now()+360000;
    const event=raw=>{
      const data=raw.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)return;
      let e;try{e=JSON.parse(data);}catch{throw Error('התקבלה תשובה פגומה משירות ה־AI.');}
      if(e.type==='error'){streamError=e.error||{message:'שגיאה במהלך הכתיבה'};return;}
      if(e.type==='message_start')usage=e.message?.usage||{};
      if(e.type==='content_block_start'&&e.content_block?.type==='text')text+=e.content_block.text||'';
      if(e.type==='content_block_delta'&&e.delta?.type==='text_delta'){text+=e.delta.text;onProgress?.(text);}
      if(e.type==='message_delta'){stop=e.delta?.stop_reason||stop;usage={...usage,...e.usage};}
      if(e.type==='message_stop')ended=true;
    };
    try{while(!ended&&!streamError){let timer;const remaining=deadline-Date.now();if(remaining<=0)throw Error('הכתיבה ארכה יותר מהצפוי. ניתן להוריד את הטיוטה החלקית ולנסות שוב.');let chunk;
        try{chunk=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('החיבור לשירות ה־AI נקטע או הפסיק להגיב. ניתן לנסות שוב.')),Math.min(90000,remaining));})]);}finally{clearTimeout(timer);}
        buffer+=chunk.done?decoder.decode():decoder.decode(chunk.value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let i;while((i=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,i));buffer=buffer.slice(i+2);}
        if(chunk.done){if(buffer.trim())event(buffer);break;}
      }
      if(streamError)return {error:streamError};
      if(!ended||!stop)throw Error('החיבור הסתיים לפני השלמת המסמך. הטיוטה לא הוצגה כמסמך שלם.');
      return {content:[{type:'text',text}],stop_reason:stop,usage};
    }finally{reader.cancel().catch(()=>{});}
  },
  async complete(opts){
    this.start();$('#generation-title').textContent='מכין את המסמך שלך';
    let full='',messages=[...opts.messages];
    for(let round=0;round<3;round++){
      const base=full;
      const result=await Api.send({...opts,max:8000,messages,returnMessage:true,onProgress:text=>{this.partial=base+text;this.update(Math.min(94,18+76*(1-Math.exp(-this.partial.length/12000))),round?'ממשיך את המסמך הארוך…':'כותב את סעיפי המסמך…');}});
      full+=result.text;this.partial=full;
      if(result.stop_reason==='end_turn'||result.stop_reason==='stop_sequence'){this.update(97,'מכין את המסמך לעריכה…');return full;}
      if(result.stop_reason!=='max_tokens')throw Error('שירות ה־AI לא השלים את המסמך (סיבה: '+(result.stop_reason||'לא ידועה')+'). נסו לשנות את ההנחיות.');
      this.update(Math.min(94,this.percent+2),'ממשיך מהמקום שבו הכתיבה נעצרה…');
      messages=[...messages,{role:'assistant',content:result.text},{role:'user',content:'Continue exactly where your previous response stopped, completing all remaining sections of the requested document. Include signature blocks only when appropriate for the document type. Do not repeat existing text or add commentary. If interrupted mid-word, finish that word first.'}];
    }
    throw Error('המסמך ארוך ממגבלת היצירה. ניתן להוריד את החלק שנוצר; צמצמו את הבקשה או חלקו אותה למסמכים נפרדים.');
  }
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>Generation.mount());else Generation.mount();
