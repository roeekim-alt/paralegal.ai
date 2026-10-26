/* PRA Legal — scoped, consent-based source discovery. No background access. */
(() => {
  'use strict';
  const MAX_SELECTED = 3;
  const MAX_FILE = 8 * 1024 * 1024;
  const MAX_TOTAL = 12 * 1024 * 1024;
  const MAX_INDEX = 700;
  const MAX_VISITS = 2400;
  const MAX_DEPTH = 5;
  const FILE_TYPES = /\.(pdf|docx|txt|md|eml|png|jpe?g|webp)$/i;
  const PRIVATE_NAMES = /^(?:\.|id_rsa|id_ed25519)|(?:password|credential|private.?key|secret|\.env|keystore)/i;
  const SKIP_DIRS = new Set(['node_modules','.git','.ssh','.aws','.config','system volume information','$recycle.bin','appdata']);
  const qs = selector => document.querySelector(selector);
  const mk = (tag, content, className) => {
    const el = document.createElement(tag);
    if(content != null)el.textContent = String(content);
    if(className)el.className = className;
    return el;
  };
  const errorText = e => e && e.name==='AbortError' ? 'הפעולה בוטלה.' : String(e?.message || e || 'שגיאה לא צפויה');
  const STOPWORDS = new Set(['של','על','עם','את','לפי','אל','שלי','אני','אתה','בין','אלו','אליי','find','the','and','for','from','file','מסמך','מסמכים','חפש','מצא']);
  const words = s => String(s||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>1&&!STOPWORDS.has(w)).slice(0,14);
  const supported = name => FILE_TYPES.test(name) && !PRIVATE_NAMES.test(name);
  const gmailBase = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const Sources = {
    ready:false, scanning:false, index:[], chosen:[], gmailToken:'', gmailExpires:0, mail:[], accountKey:null,
    activeDir:null, externalFileName:'',
    say(text, id='#p-src-status'){const el=qs(id);if(el)el.textContent=text;},
    selectedFiles(){return this.chosen.map(row=>row.file);},
    selectedNames(){return this.chosen.map(row=>row.name);},
    clear(){
      this.index=[];this.chosen=[];this.mail=[];this.activeDir=null;
      const oldToken=this.gmailToken;
      this.gmailToken='';this.gmailExpires=0;
      if(oldToken&&window.google?.accounts?.oauth2?.revoke)window.google.accounts.oauth2.revoke(oldToken,()=>{});
      this.say('החיפוש המקומי והבחירה נמחקו מהזיכרון בדפדפן. כדי לבטל גם הרשאת תיקייה מתמשכת, השתמשו בהגדרות האתר בדפדפן.');
      this.say('חיבור Gmail נותק ונמחק מהזיכרון של הדפדפן.','#p-src-gmail-status');
      this.paintIndex([]);this.paintMail([]);this.paintTray();
    },
    mount(){
      if(this.ready||!qs('#s-app .rail')||!qs('#s-app .canvas'))return;
      this.ready=true;
      const button=mk('button');button.type='button';button.className='rail-btn';button.dataset.view='sources';
      button.setAttribute('aria-label','מקורות מידע');
      button.innerHTML='<span class="premium-nav-icon" aria-hidden="true">⌕</span><span class="rail-label">מקורות מידע</span>';
      const rail=qs('#s-app .rail');rail.insertBefore(button,rail.querySelector('.rail-gap'));
      button.addEventListener('click',()=>Router.to('sources'));
      VIEW_TITLE.sources='מקורות מידע';
      this.accountKey=Account.session?.user?.id||'local';
      const section=document.createElement('section');section.className='view';section.id='v-sources';
      section.innerHTML = '<div class="scroller"><div class="premium-container src-shell" dir="rtl">' +
        '<div class="premium-heading"><div><span class="premium-eyebrow">PRA SOURCES · SCOPED ACCESS</span><h2>מקורות מידע</h2><p>אתרו קבצים בתיקייה שבחרתם, במייל שהתחברתם אליו, או דרך בורר הקבצים בטלפון. רק קבצים שתאשרו יועברו ל־AI.</p></div><button class="premium-action" id="p-src-reset">נקה ובטל בחירה</button></div>' +
        '<div class="src-grid">' +
        '<div class="agent-panel src-card"><h3>⌁ המחשב שלי</h3><p>בחרו תיקייה והרשו קריאה בלבד. החיפוש יוגבל אליה ולתיקיות המשנה שלה. לא נסרוק כוננים או תיקיות אחרות.</p><div class="agent-controls"><button class="premium-action primary" id="p-src-folder">אשר תיקייה וחפש</button><button class="premium-action" id="p-src-folder-fallback">בחירה חלופית</button><input id="p-src-folder-input" type="file" multiple webkitdirectory directory hidden></div><label for="p-src-query">מילות חיפוש במסמכים</label><input class="inp" id="p-src-query" placeholder="שם לקוח, מספר תיק, הסכם, חודש..."><label class="src-consent-row"><input id="p-src-content" type="checkbox">כלול חיפוש מקומי בתוך TXT, EML ו־DOCX (ללא העלאה למודל)</label><div class="agent-controls"><button class="premium-action" id="p-src-search">חפש בתיקייה שאושרה</button></div><p class="src-status" id="p-src-status" role="status"></p><div class="src-results" id="p-src-results"></div></div>' +
        '<div class="agent-panel src-card"><h3>✉ Gmail</h3><p>חיבור בהסכמת בעל החשבון ובהרשאת קריאה בלבד. ניתן לחפש הודעות וקבצים מצורפים, ולבחור ידנית מה לצרף לתיק.</p><div class="agent-controls"><button class="premium-action primary" id="p-src-gmail-connect">חבר Gmail</button><button class="premium-action" id="p-src-gmail-disconnect">נתק חיבור בדפדפן</button></div><label for="p-src-gmail-query">חיפוש Gmail (למשל: from:client@example.com has:attachment)</label><input class="inp" id="p-src-gmail-query" placeholder="subject:contract has:attachment"><button class="premium-action" id="p-src-gmail-search">מצא הודעות וקבצים</button><p class="src-status" id="p-src-gmail-status" role="status"></p><div class="src-results" id="p-src-mail-results"></div></div>' +
        '<div class="agent-panel src-card"><h3>▣ טלפון וקבצים נוספים</h3><p>במכשיר נייד ניתן לבחור מסמכים מהקבצים או מהאחסון בענן דרך בורר המערכת. צילום מסמך אפשרי בפורמט תמונה נתמך. אין גישה לרקע הטלפון, ל־WhatsApp או לגלריה ללא בחירה.</p><label for="p-src-phone">בחר מסמכים או תמונות</label><input id="p-src-phone" type="file" multiple accept=".pdf,.docx,.txt,.md,.eml,.png,.jpg,.jpeg,.webp,image/jpeg,image/png,image/webp,application/pdf"><p class="src-status" id="p-src-phone-status" role="status">לא נשמרים קבצים על השרת בעת הבחירה.</p></div>' +
        '<div class="agent-panel src-card src-tray"><h3>✓ קבצים מוכנים לתהליך AI</h3><p>הקבצים כאן נמצאים בזיכרון של הדפדפן בלבד. אפשר לבחור עד שלושה, ובתהליך AI נדרש אישור נפרד לפני שליחתם לספק המודל.</p><div id="p-src-selected" class="src-results"></div><div class="agent-controls"><button class="premium-action primary" id="p-src-to-agent">המשך לתהליך AI</button></div><p class="src-status">בכל רגע ניתן לנקות את הרשימה. בחירה אינה מעניקה גישה גורפת לקבצים אחרים.</p></div>' +
        '</div></div></div>';
      qs('#s-app .canvas').appendChild(section);
      qs('#p-src-reset').addEventListener('click',()=>this.clear());
      qs('#p-src-folder').addEventListener('click',()=>this.chooseDirectory());
      qs('#p-src-folder-fallback').addEventListener('click',()=>qs('#p-src-folder-input').click());
      qs('#p-src-folder-input').addEventListener('change',e=>this.importDirectoryFiles(e.target.files));
      qs('#p-src-search').addEventListener('click',()=>this.search());
      qs('#p-src-query').addEventListener('keydown',e=>{if(e.key==='Enter')this.search();});
      qs('#p-src-gmail-connect').addEventListener('click',()=>this.connectGmail());
      qs('#p-src-gmail-disconnect').addEventListener('click',()=>this.disconnectGmail());
      qs('#p-src-gmail-search').addEventListener('click',()=>this.searchGmail());
      qs('#p-src-phone').addEventListener('change',e=>this.importPhoneFiles(e.target.files));
      qs('#p-src-to-agent').addEventListener('click',()=>this.toWorkflow());
      const originalTo=Router.to.bind(Router);
      Router.to=(page)=>{
        const current=Account.session?.user?.id||'local';
        if(current!==this.accountKey){this.clear();this.accountKey=current;}
        originalTo(page);if(page==='sources')this.paintTray();
      };
      const previousLeave=Account.leave?.bind(Account);
      if(previousLeave)Account.leave=async (...args)=>{
        const result=await previousLeave(...args);
        if(!Account.session)this.clear();
        return result;
      };
      this.paintTray();
      if(!window.showDirectoryPicker)this.say('בדפדפן זה אין בחירת תיקייה מתקדמת. השתמשו ב״בחירה חלופית״ או בחרו קבצים בנפרד.');
      const client=(window.PRA_CONFIG?.gmailOAuthClientId||'').trim();
      if(!client)this.say('חיבור Gmail עדיין לא הוגדר במוצר. נדרש OAuth Client ID ואימות הרשאות של Google.','#p-src-gmail-status');
    },
    async chooseDirectory(){
      if(this.scanning)return;
      if(!window.showDirectoryPicker){qs('#p-src-folder-input').click();return;}
      try{
        const directory=await window.showDirectoryPicker({id:'pra-legal-sources',mode:'read'});
        this.activeDir=directory;
        await this.scan(directory);
      }catch(e){this.say(errorText(e));}
    },
    async scan(directory){
      this.scanning=true;this.index=[];this.paintIndex([]);
      const queue=[{handle:directory,path:directory.name||'תיקייה',depth:0}];
      let visits=0,skipped=0;
      this.say('סורק שמות ומאפייני קבצים בתיקייה שאושרה...');
      try{
        while(queue.length && visits<MAX_VISITS && this.index.length<MAX_INDEX){
          const item=queue.shift();
          for await (const [name, handle] of item.handle.entries()){
            visits++;
            if(visits>MAX_VISITS)break;
            if(handle.kind==='directory'){
              if(item.depth<MAX_DEPTH && !SKIP_DIRS.has(name.toLowerCase()) && !name.startsWith('.'))
                queue.push({handle,path:item.path+'/'+name,depth:item.depth+1});
            }else if(handle.kind==='file' && supported(name)){
              try{
                const f=await handle.getFile();
                if(f.size>0&&f.size<=MAX_FILE){
                  this.index.push({id:'folder:'+item.path+'/'+name,file:f,name:f.name,path:item.path+'/'+name,kind:'folder',content:null});
                }else skipped++;
              }catch{skipped++;}
            }
            if(this.index.length>=MAX_INDEX)break;
          }
        }
        this.search();
        this.say('נסרקו '+visits+' פריטים. נמצאו '+this.index.length+' קבצים נתמכים. '+(skipped?'דולגו '+skipped+' קבצים חריגים. ':'')+(visits>=MAX_VISITS||this.index.length>=MAX_INDEX?'הגעתם למגבלת הסריקה; צמצמו את התיקייה כדי לכלול יותר קבצים.':''));
      }catch(e){this.say('הסריקה הופסקה: '+errorText(e));}
      finally{this.scanning=false;}
    },
    importDirectoryFiles(list){
      this.index=[];const files=Array.from(list||[]);let count=0;
      for(const f of files){
        if(this.index.length>=MAX_INDEX)break;
        count++;
        if(!supported(f.name)||f.size===0||f.size>MAX_FILE)continue;
        const path=f.webkitRelativePath||f.name;
        this.index.push({id:'folder:'+path,file:f,name:f.name,path,kind:'folder',content:null});
      }
      this.search();
      this.say('נבחרו '+files.length+' קבצים באמצעות בורר המערכת; נמצאו '+this.index.length+' קבצים נתמכים (עד '+MAX_INDEX+').');
      qs('#p-src-folder-input').value='';
    },
    async search(){
      const query=qs('#p-src-query').value.trim();
      const terms=words(query);
      const withContent=!!qs('#p-src-content').checked;
      if(!this.index.length){this.say('אין קבצים באינדקס. תחילה יש לאשר תיקייה.');this.paintIndex([]);return;}
      this.say('מחפש בתוך הרשימה שאושרה...');
      // Explicit opt-in: read only a bounded amount of supported text in the current browser.
      if(withContent && terms.length){
        let budget=180;
        for(const item of this.index){
          if(budget<=0)break;
          if(item.content!==null)continue;
          if(!/\.(txt|md|eml|docx)$/i.test(item.name))continue;
          if(item.file.size>850000)continue;
          try{
            if(/\.docx$/i.test(item.name)){
              if(!window.mammoth?.extractRawText)continue;
              const extracted=await window.mammoth.extractRawText({arrayBuffer:await item.file.arrayBuffer()});
              item.content=String(extracted.value||'').slice(0,65000).toLowerCase();
            }else item.content=(await item.file.text()).slice(0,65000).toLowerCase();
            budget--;
          }catch{item.content='';budget--;}
        }
      }
      let matches=this.index.map(item=>{
        const path=item.path.toLowerCase(),name=item.name.toLowerCase(),content=withContent?item.content||'':'';
        let hits=0;
        for(const t of terms){if(name.includes(t))hits+=4;else if(path.includes(t))hits+=2;else if(content.includes(t))hits++;}
        return {item,score:hits};
      }).filter(r=>!terms.length||r.score>0);
      matches.sort((a,b)=>b.score-a.score||b.item.file.lastModified-a.item.file.lastModified);
      this.paintIndex(matches.slice(0,70).map(x=>x.item));
      this.say('נמצאו '+matches.length+' קבצים מתאימים. '+(withContent?'התוכן של קובצי טקסט ו־Word קטנים נסרק מקומית בלבד; PDF ותמונות נבדקים לפי שם.':'החיפוש לפי שם קובץ ונתיב בלבד.')+(matches.length>70?' מוצגים 70 הראשונים.':''));
    },
    paintIndex(rows){
      const host=qs('#p-src-results');if(!host)return;
      host.replaceChildren();
      if(!rows.length){host.append(mk('p','אין תוצאות להצגה.','src-muted'));return;}
      for(const item of rows)host.append(this.itemRow(item.name,item.path+' · '+this.size(item.file.size),'בחר',()=>this.addFile(item.file,'מחשב',item.id)));
    },
    size(n){return n>=1024*1024?(n/(1024*1024)).toFixed(1)+'MB':Math.round(n/1024)+'KB';},
    itemRow(title,sub,label,action){
      const el=mk('div',null,'src-item'),copy=mk('div',null,'src-item-copy');
      const titleEl=mk('strong',title),small=mk('small',sub);
      copy.append(titleEl,small);
      const b=mk('button',label,'premium-action');b.type='button';b.addEventListener('click',action);
      el.append(copy,b);return el;
    },
    addFile(file,from,id){
      if(!file||!supported(file.name)){this.say('סוג קובץ אינו נתמך או ששמו נראה כקובץ סודות.','#p-src-status');return false;}
      if(file.size<=0||file.size>MAX_FILE){this.say('ניתן לבחור קובץ עד 8MB בלבד.');return false;}
      const key=id||from+':'+file.name+':'+file.size+':'+file.lastModified;
      if(this.chosen.some(row=>row.id===key)){this.say('הקובץ כבר נבחר.');return false;}
      if(this.chosen.length>=MAX_SELECTED){this.say('ניתן להעביר עד שלושה קבצים בכל תהליך AI.');return false;}
      if(this.chosen.reduce((n,r)=>n+r.file.size,0)+file.size>MAX_TOTAL){this.say('נפח הקבצים הכולל עולה על 12MB.');return false;}
      this.chosen.push({id:key,file,name:file.name,from});
      this.paintTray();this.say('נבחר: '+file.name+'. הקובץ לא נשלח לשום שירות.');
      return true;
    },
    removeFile(id){this.chosen=this.chosen.filter(row=>row.id!==id);this.paintTray();},
    paintTray(){
      const host=qs('#p-src-selected');if(!host)return;host.replaceChildren();
      if(!this.chosen.length){host.append(mk('p','טרם נבחרו קבצים.','src-muted'));const disabled=qs('#p-src-to-agent');if(disabled)disabled.disabled=true;return;}
      for(const row of this.chosen){
        host.append(this.itemRow(row.name,row.from+' · '+this.size(row.file.size),'הסר',()=>this.removeFile(row.id)));
      }
      const btn=qs('#p-src-to-agent');if(btn)btn.disabled=!this.chosen.length;
    },
    importPhoneFiles(list){
      let success=0;
      for(const file of Array.from(list||[]))if(this.addFile(file,'טלפון / קבצים'))success++;
      this.say('נבחרו '+success+' קבצים. הם יישלחו למודל רק לאחר פתיחת AI Workflows ואישור מפורש.','#p-src-phone-status');
      qs('#p-src-phone').value='';
    },
    toWorkflow(){
      if(!this.chosen.length){this.say('יש לבחור קודם קבצים.');return;}
      Router.to('workflows');
      const linked=qs('#p-agent-linked');
      if(linked)linked.textContent='קבצים מאושרים ממקורות מידע ('+this.chosen.length+'): '+this.selectedNames().join(' · ')+'. הם יועברו רק אחרי לחיצה על התחלת תהליך ואישור העברת המידע.';
    },
    suggestFromMatter(title,facts){
      const nameWords=words(title).filter(x=>x.length>2).slice(0,5);
      const extra=words(facts).filter(x=>x.length>3&&!nameWords.includes(x)).slice(0,3);
      const terms=[...nameWords,...extra];
      Router.to('sources');
      if(!terms.length){this.say('הזינו קודם שם תיק או עובדות בתהליך ה־AI, ואז הפעילו חיפוש אוטומטי.');return;}
      const query=terms.join(' ');qs('#p-src-query').value=query;
      if(this.index.length)this.search();
      else this.say('מילות החיפוש הוכנו: '+query+'. תחילה בחרו תיקייה, ולאחר מכן החיפוש יפעל בתוך התיקייה שאושרה.');
      if(this.gmailToken&&this.gmailExpires>Date.now()){
        qs('#p-src-gmail-query').value=terms.slice(0,4).join(' ');
        this.searchGmail();
      }
    },
    async googleScript(){
      if(window.google?.accounts?.oauth2)return;
      await new Promise((resolve,reject)=>{
        const existing=qs('script[data-pra-gsi]');
        if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',()=>reject(Error('שירות ההתחברות של Google לא נטען.')),{once:true});return;}
        const el=document.createElement('script');
        el.src='https://accounts.google.com/gsi/client';el.async=true;el.defer=true;el.dataset.praGsi='1';
        el.onload=resolve;el.onerror=()=>reject(Error('שירות ההתחברות של Google לא נטען.'));
        document.head.appendChild(el);
      });
    },
    async connectGmail(){
      const clientId=String(window.PRA_CONFIG?.gmailOAuthClientId||'').trim();
      if(!clientId){this.say('חיבור Gmail דורש הגדרת OAuth Client ID ציבורי, Google OAuth consent screen ואימות ההרשאה gmail.readonly. אין חיבור פעיל כרגע.','#p-src-gmail-status');return;}
      try{
        if(!window.google?.accounts?.oauth2){await this.googleScript();this.say('רכיב Google נטען. לחצו שוב על ״חבר Gmail״ כדי לפתוח את חלון ההרשאה.','#p-src-gmail-status');return;}
        const token=await new Promise((resolve,reject)=>{
          const c=window.google.accounts.oauth2.initTokenClient({
            client_id:clientId,scope:'https://www.googleapis.com/auth/gmail.readonly',
            callback:response=>response?.access_token?resolve(response):reject(Error(response?.error||'לא התקבל אישור Gmail.')),
            error_callback:()=>reject(Error('חלון ההרשאה נסגר או נכשל.'))
          });
          c.requestAccessToken({prompt:'consent'});
        });
        this.gmailToken=token.access_token;
        this.gmailExpires=Date.now()+(Math.max(60,Number(token.expires_in)||3600)-30)*1000;
        this.say('Gmail מחובר לקריאה בלבד למשך ההרשאה הזמנית. הזינו חיפוש ובחרו את הקבצים הרלוונטיים.','#p-src-gmail-status');
      }catch(e){this.say('חיבור Gmail נכשל: '+errorText(e),'#p-src-gmail-status');}
    },
    disconnectGmail(){
      const token=this.gmailToken;this.gmailToken='';this.gmailExpires=0;this.mail=[];
      this.paintMail([]);
      if(token&&window.google?.accounts?.oauth2?.revoke)window.google.accounts.oauth2.revoke(token,()=>{});
      this.say('הטוקן נמחק מהזיכרון בדפדפן, ונשלחה ל־Google בקשת ביטול הרשאה כאשר השירות זמין.','#p-src-gmail-status');
    },
    async gmailFetch(url){
      if(!this.gmailToken||this.gmailExpires<Date.now())throw Error('ההרשאה הזמנית פגה. התחברו מחדש.');
      const res=await fetch(url,{headers:{Authorization:'Bearer '+this.gmailToken},cache:'no-store'});
      if(!res.ok)throw Error('Gmail החזיר HTTP '+res.status+'. בדקו את הרשאות החשבון ואת הגדרות ה־OAuth.');
      return await res.json();
    },
    async searchGmail(){
      const q=qs('#p-src-gmail-query').value.trim();
      if(!q||q.length<3){this.say('יש להזין לפחות שלושה תווים לחיפוש.','#p-src-gmail-status');return;}
      if(!this.gmailToken){this.say('תחילה יש להתחבר ל־Gmail בהרשאה מפורשת.','#p-src-gmail-status');return;}
      try{
        this.say('מחפש הודעות בחשבון המחובר. תוכן אינו נשלח למודל.','#p-src-gmail-status');
        const params=new URLSearchParams({q,maxResults:'12'});
        const result=await this.gmailFetch(gmailBase+'/messages?'+params);
        const messages=result.messages||[];
        const found=[];
        // Format full exposes MIME part names, but nothing is saved outside this browser memory.
        for(const item of messages){
          const msg=await this.gmailFetch(gmailBase+'/messages/'+encodeURIComponent(item.id)+'?format=full');
          const h=msg.payload?.headers||[];
          const header=name=>(h.find(x=>x.name?.toLowerCase()===name)?.value||'').slice(0,160);
          const subject=header('subject')||'(ללא נושא)',from=header('from'),date=header('date');
          const parts=[];
          const dive=part=>{
            if(part.filename && supported(part.filename)){
              parts.push({id:'gmail:'+msg.id+':'+part.partId+':'+part.filename,
                type:'attachment',name:part.filename,msgId:msg.id,
                attachId:part.body?.attachmentId||'',inline:part.body?.data||'',bytes:part.body?.size||0,
                subject,from,date});
            }
            for(const child of part.parts||[])dive(child);
          };
          dive(msg.payload||{});
          for(const p of parts)found.push(p);
          found.push({id:'gmail:'+msg.id+':body',type:'message',name:'הודעה: '+subject,subject,from,date,msgId:msg.id,message:msg});
        }
        this.mail=found;
        this.paintMail(found);
        this.say('נמצאו '+messages.length+' הודעות ו־'+found.filter(x=>x.type==='attachment').length+' קבצים מצורפים נתמכים. מוצגות לכל היותר 12 הודעות.','#p-src-gmail-status');
      }catch(e){this.say(errorText(e),'#p-src-gmail-status');}
    },
    paintMail(items){
      const host=qs('#p-src-mail-results');if(!host)return;host.replaceChildren();
      if(!items.length){host.append(mk('p','אין תוצאות להצגה.','src-muted'));return;}
      for(const item of items){
        const subtitle=(item.subject+' · '+item.from+' · '+item.date).slice(0,260);
        host.append(this.itemRow(item.name,subtitle,item.type==='attachment'?'בחר קובץ':'בחר הודעה',()=>this.queueMail(item)));
      }
    },
    decode64(text){
      const base=String(text||'').replace(/-/g,'+').replace(/_/g,'/');
      const binary=atob(base);
      const out=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
      return out;
    },
    extractBody(message){
      let plain='',html='';
      const dive=part=>{
        const kind=part.mimeType||'';
        if(kind==='text/plain'&&part.body?.data && !plain)plain=part.body.data;
        if(kind==='text/html'&&part.body?.data && !html)html=part.body.data;
        for(const p of part.parts||[])dive(p);
      };
      dive(message.payload||{});
      const data=plain||html;
      if(!data)return '[גוף ההודעה אינו זמין באופן מקומי]';
      const bytes=this.decode64(data);
      let content=new TextDecoder().decode(bytes);
      if(!plain){
        const parsed=new DOMParser().parseFromString(content,'text/html');
        parsed.querySelectorAll('script,style,iframe,object').forEach(el=>el.remove());
        content=parsed.body?.textContent||'';
      }
      if(content.length>14000)throw Error('גוף ההודעה ארוך מדי; צמצמו אותו לפני צירוף.');
      return content;
    },
    async queueMail(item){
      if(this.chosen.length>=MAX_SELECTED){this.say('ניתן לבחור עד שלושה קבצים.','#p-src-gmail-status');return;}
      try{
        let f;
        if(item.type==='attachment'){
          if(item.bytes>MAX_FILE)throw Error('הקובץ גדול מ־8MB.');
          const data=item.attachId ? (await this.gmailFetch(gmailBase+'/messages/'+encodeURIComponent(item.msgId)+'/attachments/'+encodeURIComponent(item.attachId))).data : item.inline;
          if(!data)throw Error('לא ניתן לקרוא את הצרופה.');
          const bytes=this.decode64(data);
          if(bytes.length>MAX_FILE)throw Error('הקובץ גדול מ־8MB.');
          f=new File([bytes],item.name,{type:'application/octet-stream'});
        }else{
          const body=this.extractBody(item.message);
          const text='Subject: '+item.subject+'\nFrom: '+item.from+'\nDate: '+item.date+'\n\n'+body;
          f=new File([text],'email-'+item.msgId+'.eml',{type:'text/plain'});
        }
        if(this.addFile(f,'Gmail',item.id))this.say('נוסף לתהליך: '+item.name+'. לא נשלח למודל.','#p-src-gmail-status');
      }catch(e){this.say('בחירת ההודעה נכשלה: '+errorText(e),'#p-src-gmail-status');}
    }
  };
  window.PRASources=Sources;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>Sources.mount());
  else Sources.mount();
})();