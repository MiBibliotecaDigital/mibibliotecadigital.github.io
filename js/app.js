import{createClient}from'https://esm.sh/@supabase/supabase-js@2';
const c=window.BIBLIOTECA_CONFIG||{},live=!!(c.supabaseUrl&&c.supabaseAnonKey&&c.demoMode===false),db=live?createClient(c.supabaseUrl,c.supabaseAnonKey):null,root=document.querySelector('#app');
let me=null,role='reader',page='home',query='',books=[],pendingDocs=[],users=[],collections=[],selectedFiles=[],favs=new Set(),history=[];
const sample=[['d1','Atlas del Archipielago Luminario','Elena Mar de Papel','Geografia imaginaria','atlas-luminario.pdf','sea'],['d2','Herbario de Arrecife Azul','Tomas del Invernadero','Naturaleza','herbario-arrecife-azul.pdf','leaf'],['d3','Cuaderno musical de Ciudad Resonante','Mara Afinacion','Musica','cuaderno-musica-ciudad.pdf','amber']].map(x=>({id:x[0],title:x[1],author:x[2],category:x[3],year:2026,pages:1,size:'PDF de muestra',provider:'demo',path:'/demo/pdfs/'+x[4],tone:x[5]}));
const demoUsers=[{name:'Administracion de prueba',email:'admin@biblioteca.local',role:'admin',status:'Activo'},{name:'Lector de ejemplo',email:'demo@biblioteca.local',role:'reader',status:'Activo'}];
const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),label=r=>r==='admin'?'Administrador':r==='editor'?'Editor':'Lector';
function toast(s){let n=document.createElement('div');n.className='toast';n.textContent=s;document.body.append(n);setTimeout(()=>n.remove(),2800)}
function login(msg=''){root.innerHTML='<div class="demo-strip">'+(live?'ACCESO PRIVADO · SUPABASE':'MODO DEMOSTRACION · USUARIOS FICTICIOS')+'</div><main class="login"><section class="art" aria-hidden="true"><div class="brand"><b>B</b></div></section><section class="login-side"><form id="login"><div class="mark">B</div><h2>Bienvenido</h2><p>Ingresa para continuar a tu biblioteca.</p>'+(msg?'<div class="notice">'+esc(msg)+'</div>':'')+'<label>Correo electronico<input name="email" type="email" required></label><label>Contrasena<input name="password" type="password" required></label><button class="primary">Ingresar →</button>'+(live?'':'<div class="demo-box"><b>CUENTAS FICTICIAS</b>Administrador: admin@biblioteca.local <code>admin1234</code>Lector: demo@biblioteca.local <code>demo1234</code><small>Solo para probar la interfaz. No son cuentas reales ni protegen datos privados.</small></div>')+'</form></section></main>';document.querySelector('#login').onsubmit=signIn}
async function signIn(e){e.preventDefault();let f=new FormData(e.currentTarget),email=String(f.get('email')).toLowerCase(),password=String(f.get('password'));if(!live){let a=email==='admin@biblioteca.local'&&password==='admin1234'?['Administracion de prueba','admin']:email==='demo@biblioteca.local'&&password==='demo1234'?['Lector de ejemplo','reader']:null;if(!a)return login('Credenciales incorrectas. Usa las cuentas de prueba.');me={email,name:a[0]};role=a[1];books=sample;users=demoUsers;return render()}let {data,error}=await db.auth.signInWithPassword({email,password});if(error)return login(error.message);await loadUser(data.user)}
async function loadUser(u){let {data:p,error}=await db.from('profiles').select('full_name,role,status').eq('id',u.id).single();if(error||!p||p.status!=='active'){await db.auth.signOut();return login('Cuenta sin perfil activo.')}me={id:u.id,email:u.email,name:p.full_name||u.email};role=p.role;let docQuery=db.from('documents').select('id,title,authors,publication_year,category,page_count,size_bytes,provider,demo_path,is_published,description,collection_id').order('title');if(role!=='admin')docQuery=docQuery.eq('is_published',true);let {data:d,error:de}=await docQuery;if(de){books=[];pendingDocs=[];toast(de.message)}else{const rows=d||[];const mapDoc=(x,i)=>({id:x.id,title:x.title,author:(x.authors||[]).join(', '),authors:x.authors||[],year:x.publication_year||'',category:x.category||'General',pages:x.page_count||'—',size:x.size_bytes?Math.round(x.size_bytes/1024)+' KB':'—',sizeBytes:x.size_bytes||0,provider:x.provider,path:x.demo_path||'',description:x.description||'',collectionId:x.collection_id||'',tone:['sea','leaf','amber'][i%3]});books=rows.filter(x=>x.is_published).map(mapDoc);pendingDocs=role==='admin'?rows.filter(x=>!x.is_published).map(mapDoc):[];}if(role==='admin'){let {data:cs}=await db.from('collections').select('id,name').order('name');collections=cs||[];let {data:ps}=await db.from('profiles').select('id,full_name,role,status').order('created_at',{ascending:false});users=(ps||[]).map(x=>({name:x.full_name,email:x.id,role:x.role,status:x.status==='active'?'Activo':'Suspendido'}))}else collections=[];render();
  const pendingDocument=new URLSearchParams(window.location.search).get('open');
  if(pendingDocument){
    const cleanUrl=new URL(window.location.href);cleanUrl.searchParams.delete('open');
    window.history.replaceState({},'',cleanUrl.pathname+cleanUrl.search+cleanUrl.hash);
    if(books.some(x=>x.id===pendingDocument)||pendingDocs.some(x=>x.id===pendingDocument))setTimeout(()=>openBook(pendingDocument),0);
    else setTimeout(()=>toast('El documento solicitado no está disponible para esta cuenta.'),0);
  }
}
function nav(p,t){return '<button class="nav '+(page===p?'active':'')+'" data-page="'+p+'">'+t+'</button>'}
function card(b){return '<article class="book"><div class="cover '+b.tone+'"><small>MI BIBLIOTECA · PDF</small><strong>'+esc(b.title)+'</strong><span>'+esc(b.author)+'</span></div><div class="info"><em>'+esc(b.category)+'</em><h3>'+esc(b.title)+'</h3><p>'+esc(b.author)+' · '+esc(b.year)+'</p><footer><button class="fav" data-fav="'+esc(b.id)+'">'+(favs.has(b.id)?'♥':'♡')+'</button><small>'+esc(b.size)+'</small><button data-open="'+esc(b.id)+'">Leer PDF</button></footer></div></article>'}
function filtered(){return books.filter(b=>(page!=='favorites'||favs.has(b.id))&&(!query||(b.title+' '+b.author+' '+b.category).toLowerCase().includes(query.toLowerCase())))}
function uploadPage(){return '<div class="heading"><div><h1>Subida múltiple</h1><p>Seleccioná varios PDFs. Se guardarán como borradores privados para completar sus fichas después.</p></div></div><form class="panel upload-panel" id="upload-form"><label class="upload-drop" id="upload-drop" for="upload-files"><strong>Elegí o arrastrá varios archivos PDF</strong><span>Podés seleccionar hasta 20 archivos por tanda · 2 GiB por archivo</span><input id="upload-files" name="files" type="file" accept=".pdf,application/pdf" multiple required></label><div id="upload-file-list" class="upload-file-list"><span class="muted">Todavía no seleccionaste archivos.</span></div><div class="upload-note">Los archivos no se publican al terminar la subida. Primero quedan en R2 como documentos privados; después podés completar título, autor, año, categoría y colección desde Metadatos. El título provisional sale del nombre del archivo.</div><button class="primary" id="upload-submit" type="submit" disabled>Subir PDFs seleccionados</button><div id="upload-results" class="upload-results" aria-live="polite"></div></form>'}
function renderUploadSelection(){
  const list=document.querySelector('#upload-file-list'),button=document.querySelector('#upload-submit');
  if(!list||!button)return;
  const total=selectedFiles.reduce((n,f)=>n+f.size,0);
  list.innerHTML=selectedFiles.length?'<div class="upload-selection-summary">'+selectedFiles.length+' archivo(s) · '+(total/1024/1024).toFixed(1)+' MiB</div>'+selectedFiles.map((f,i)=>'<div class="upload-file-row"><span>'+esc(f.name)+'</span><small>'+Math.ceil(f.size/1024)+' KiB</small></div>').join(''):'<span class="muted">Todavía no seleccionaste archivos.</span>';
  button.disabled=!selectedFiles.length||selectedFiles.length>20;
  button.textContent=selectedFiles.length?'Subir '+selectedFiles.length+' PDF(s)':'Subir PDFs seleccionados';
  if(selectedFiles.length>20)list.insertAdjacentHTML('beforeend','<p class="upload-error">El máximo por tanda es de 20 archivos.</p>');
}
async function uploadOneFile(file,token,onProgress){
  const base=(c.pdfGatewayUrl||'').replace(/\/+$/,'');
  const auth={Authorization:'Bearer '+token};
  let upload=null;
  const abort=async()=>{if(!upload)return;const url=new URL(base+'/upload/abort');url.searchParams.set('key',upload.key);url.searchParams.set('uploadId',upload.uploadId);try{await fetch(url,{method:'DELETE',headers:auth})}catch{}};
  try{
    const start=await fetch(base+'/upload/start',{method:'POST',headers:{...auth,'X-File-Size':String(file.size)}});
    if(!start.ok)throw new Error((await start.text())||'No se pudo iniciar la carga.');
    upload=await start.json();
    if(!upload?.key||!upload?.uploadId||!Number(upload.partSize))throw new Error('El servidor devolvió datos de carga incompletos.');
    const parts=[];let offset=0,partNumber=1;
    while(offset<file.size){
      const end=Math.min(offset+upload.partSize,file.size),chunk=file.slice(offset,end);
      const url=new URL(base+'/upload/part');url.searchParams.set('key',upload.key);url.searchParams.set('uploadId',upload.uploadId);url.searchParams.set('partNumber',String(partNumber));
      const response=await fetch(url,{method:'PUT',headers:{...auth,'Content-Type':'application/octet-stream'},body:chunk});
      if(!response.ok)throw new Error((await response.text())||'Falló el fragmento '+partNumber+'.');
      parts.push(await response.json());offset=end;partNumber++;
      onProgress?.(Math.round(offset/file.size*100));
    }
    const fileName=file.name.slice(0,255);
    const complete=await fetch(base+'/upload/complete',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({key:upload.key,uploadId:upload.uploadId,parts,fileSize:file.size,fileName})});
    if(!complete.ok)throw new Error((await complete.text())||'No se pudo finalizar la carga.');
    const result=await complete.json();upload=null;
    return result.document;
  }catch(error){await abort();throw error}
}
async function uploadMultiple(e){
  e.preventDefault();
  if(role!=='admin'||!live)return toast('Solo el administrador puede cargar documentos.');
  const files=[...selectedFiles];
  if(!files.length)return toast('Seleccioná al menos un PDF.');
  if(files.length>20)return toast('El máximo por tanda es de 20 archivos.');
  const invalid=files.find(f=>!/\.pdf$/i.test(f.name)||(f.type&&f.type!=='application/pdf')||f.size<100||f.size>2*1024*1024*1024);
  if(invalid)return toast('Revisá "'+invalid.name+'": debe ser un PDF válido de hasta 2 GiB.');
  const {data:{session}}=await db.auth.getSession();
  if(!session?.access_token)return login('Tu sesión expiró. Inicia sesión nuevamente.');
  if(!c.pdfGatewayUrl)return toast('Falta configurar el gateway PDF.');
  const form=e.currentTarget,button=form.querySelector('#upload-submit'),results=form.querySelector('#upload-results');
  button.disabled=true;
  results.innerHTML=files.map((f,i)=>'<div class="upload-result" data-upload-row="'+i+'"><div><strong>'+esc(f.name)+'</strong><span class="upload-result-status">En cola</span></div><progress max="100" value="0"></progress></div>').join('');
  let success=0,failed=0;
  for(let i=0;i<files.length;i++){
    const row=results.querySelector('[data-upload-row="'+i+'"]'),status=row.querySelector('.upload-result-status'),progress=row.querySelector('progress');
    status.textContent='Preparando...';
    try{
      const document=await uploadOneFile(files[i],session.access_token,p=>{progress.value=p;status.textContent='Subiendo · '+p+'%'});
      progress.value=100;status.textContent='Subido · pendiente de metadatos';row.classList.add('upload-result-success');success++;
    }catch(error){
      status.textContent='Error · '+(error?.message||'No se pudo subir');row.classList.add('upload-result-error');failed++;
    }
  }
  selectedFiles=[];form.reset();renderUploadSelection();
  if(success){page='pending';query='';await loadUser(me)}
  button.disabled=false;
  toast(success+' PDF(s) subidos'+(failed?' · '+failed+' error(es)':'')+'.');
}
function pendingPage(){
  return '<div class="heading"><div><h1>Metadatos pendientes</h1><p>Los documentos de esta lista están guardados en privado y todavía no aparecen para los lectores.</p></div><span class="tag">'+pendingDocs.length+' pendientes</span></div><div class="notice metadata-help"><b>¿Querés ayuda para completar las fichas?</b><span>Podés adjuntar aquí en ChatGPT los PDFs originales, incluso en tandas. Puedo revisar portada, portadilla y páginas legales para proponerte título, autor, año y otros datos. La web no llama a ChatGPT por sí sola; la asistencia se hace en esta conversación.</span></div>'+(pendingDocs.length?'<div class="panel"><table class="pending-table"><tr><th>Documento (nombre provisional)</th><th>Tamaño</th><th>Estado</th><th></th></tr>'+pendingDocs.map(d=>'<tr><td>'+esc(d.title)+'</td><td>'+esc(d.size)+'</td><td><span class="pending-tag">Privado</span></td><td><button class="small-action" data-edit-doc="'+esc(d.id)+'">Completar ficha</button><button class="small-action" data-open="'+esc(d.id)+'">Vista previa</button></td></tr>').join('')+'</table>':'<div class="panel empty-state">No hay fichas pendientes. Cuando subas PDFs, aparecerán aquí.')+'</div>';
}
function editDocumentMetadata(id){
  const d=pendingDocs.find(x=>x.id===id);if(!d)return;
  const m=document.createElement('div');m.className='modal-bg';
  m.innerHTML='<section class="modal metadata-modal"><header><b>Completar ficha bibliográfica</b><button id="close" type="button">Cerrar ×</button></header><p class="muted">'+esc(d.title)+' · '+esc(d.size)+'</p><form id="metadata-form"><label>Título<input name="title" maxlength="300" required value="'+esc(d.title)+'"></label><label>Autor/es<input name="authors" maxlength="1000" value="'+esc(d.authors.join(', '))+'" placeholder="Separar varios autores con coma"></label><div class="upload-grid"><label>Categoría<input name="category" maxlength="100" value="'+esc(d.category)+'" required></label><label>Año de publicación<input name="publicationYear" type="number" min="1000" max="2100" value="'+esc(d.year)+'" placeholder="Opcional"></label><label>Colección<select name="collectionId"><option value="">Sin colección</option>'+collections.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===d.collectionId?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></label></div><label>Descripción<textarea name="description" rows="4" maxlength="3000">'+esc(d.description)+'</textarea></label><div class="metadata-actions"><button class="secondary" id="save-draft" type="button">Guardar sin publicar</button><button class="primary" type="submit">Guardar y publicar</button></div></form></section>';
  document.body.append(m);m.querySelector('#close').onclick=()=>m.remove();m.onclick=e=>{if(e.target===m)m.remove()};
  const save=async publish=>{
    const form=m.querySelector('#metadata-form'),data=new FormData(form),title=String(data.get('title')||'').trim(),year=String(data.get('publicationYear')||'');
    if(!title)return toast('El título es obligatorio.');
    const values={title,authors:String(data.get('authors')||'').split(',').map(x=>x.trim()).filter(Boolean),publication_year:year?Number(year):null,category:String(data.get('category')||'General').trim()||'General',description:String(data.get('description')||'').trim(),collection_id:String(data.get('collectionId')||'')||null,is_published:publish};
    if(values.publication_year!==null&&(!Number.isInteger(values.publication_year)||values.publication_year<1000||values.publication_year>2100))return toast('Revisá el año de publicación.');
    const {error}=await db.from('documents').update(values).eq('id',id);
    if(error)return toast('No se pudo guardar: '+error.message);
    m.remove();toast(publish?'Ficha publicada en el catálogo.':'Ficha guardada como pendiente.');await loadUser(me);
  };
  m.querySelector('#save-draft').onclick=()=>save(false);
  m.querySelector('#metadata-form').onsubmit=e=>{e.preventDefault();save(true)};
}

function usersPage(){return '<div class="heading"><div><h1>Usuarios</h1><p>Administracion de cuentas y privilegios.</p></div><button class="primary" id="add">+ Crear usuario</button></div>'+(live?'':'<div class="notice">Usuarios ficticios; no se crean cuentas reales en modo demo.</div>')+'<div class="panel"><h2>Cuentas registradas</h2><table><tr><th>Usuario</th><th>Privilegio</th><th>Estado</th></tr>'+users.map(u=>'<tr><td>'+esc(u.name)+'<small>'+esc(u.email)+'</small></td><td>'+label(u.role)+'</td><td>'+esc(u.status)+'</td></tr>').join('')+'</table></div>'}
function content(){if(page==='upload'&&role==='admin')return uploadPage();if(page==='pending'&&role==='admin')return pendingPage();if(page==='users'&&role==='admin')return usersPage();if(page==='settings')return '<div class="heading"><h1>Configuracion</h1></div><div class="panel"><h2>Supabase</h2><p>'+(live?'Autenticacion conectada.':'Modo demo; falta configurar credenciales.')+'</p><h2>Cloudflare R2</h2><p>Bucket privado biblioteca-digital-archivos. Binding privado conectado. La pasarela entrega documentos con autorización de Supabase.</p><h2>Seguridad</h2><p>Los nuevos PDFs quedan privados como borradores hasta que completes y publiques sus fichas.</p></div>';let list=filtered(),title=page==='favorites'?'Mis favoritos':page==='catalog'?'Todos los libros':page==='collections'?'Colecciones':'Tu biblioteca, a mano.';return '<div class="heading"><div><h1>'+title+'</h1><p>Hola, '+esc(me.name)+'. Tu coleccion organizada en un solo lugar.</p></div><span class="tag">'+list.length+' documentos</span></div>'+(page==='home'?'<div class="stats"><div>Documentos<b>'+books.length+'</b></div><div>Colecciones<b>3</b></div><div>Favoritos<b>'+favs.size+'</b></div><div>Lecturas<b>'+history.length+'</b></div></div>':'')+'<div class="chips"><button data-cat="all">Todos</button><button data-cat="Geografia imaginaria">Geografia</button><button data-cat="Naturaleza">Naturaleza</button><button data-cat="Musica">Musica</button></div><div class="grid">'+list.map(card).join('')+'</div><p class="footnote">'+(live?'Acceso a documentos autorizados por tu cuenta.':'Los PDF son ficticios y publicos, solo para probar la interfaz.')+'</p>'}
function render(){root.innerHTML=(live?'':'<div class="demo-strip">MODO DEMOSTRACION · sin autenticacion real</div>')+'<aside class="sidebar"><div class="brand"><b>B</b> MI BIBLIOTECA</div><small>BIBLIOTECA</small>'+nav('home','⌂ Resumen')+nav('catalog','▤ Todos los libros')+nav('favorites','♡ Favoritos')+nav('collections','▦ Colecciones')+(role==='admin'?'<small>GESTION</small>'+nav('users','♙ Usuarios')+nav('settings','⚙ Configuracion')+nav('upload','＋ Subir PDFs')+nav('pending','✎ Metadatos ('+pendingDocs.length+')'):'')+'<div class="side-bottom"><b>'+esc(me.name)+'</b><small>'+label(role)+'</small><button id="logout">Cerrar sesion ↗</button></div></aside><main class="main"><header><span>Mi Biblioteca / '+esc(page)+'</span><input id="search" placeholder="Buscar titulo, autor..." value="'+esc(query)+'"><b>'+esc(me.name)+'</b></header><section class="page">'+content()+'</section></main>';document.querySelectorAll('[data-page]').forEach(x=>x.onclick=()=>{page=x.dataset.page;render()});document.querySelector('#logout').onclick=signOut;document.querySelector('#search').oninput=e=>{query=e.target.value;let g=document.querySelector('.grid');if(g)g.innerHTML=filtered().map(card).join('');bindBooks()};document.querySelectorAll('[data-cat]').forEach(x=>x.onclick=()=>{page='catalog';query=x.dataset.cat==='all'?'':x.dataset.cat;render()});document.querySelector('#add')?.addEventListener('click',addUser);document.querySelector('#upload-form')?.addEventListener('submit',uploadMultiple);document.querySelector('#upload-files')?.addEventListener('change',e=>{selectedFiles=Array.from(e.target.files||[]);renderUploadSelection()});const drop=document.querySelector('#upload-drop');drop?.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging')});drop?.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop?.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');selectedFiles=Array.from(e.dataTransfer?.files||[]);renderUploadSelection()});document.querySelector('#pending')?.addEventListener('click',()=>{page='pending';render()});document.querySelectorAll('[data-edit-doc]').forEach(x=>x.onclick=()=>editDocumentMetadata(x.dataset.editDoc));bindBooks()}
function bindBooks(){document.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>openBook(x.dataset.open));document.querySelectorAll('[data-fav]').forEach(x=>x.onclick=()=>{favs.has(x.dataset.fav)?favs.delete(x.dataset.fav):favs.add(x.dataset.fav);render()})}
async function openBook(id){
  const b=books.find(x=>x.id===id)||pendingDocs.find(x=>x.id===id);if(!b)return;
  history.unshift(id);
  if(!live||b.provider==='demo'){
    const url=b.path;
    if(!url)return toast('Archivo aun no asociado');
    const m=document.createElement('div');m.className='modal-bg';
    m.innerHTML='<section class="modal"><header><b>'+esc(b.title)+'</b><button id="close">Cerrar ×</button></header><div class="notice">PDF ficticio de demostración; no contiene material privado.</div><iframe src="'+esc(url)+'" title="PDF de demostración"></iframe></section>';
    document.body.append(m);m.querySelector('#close').onclick=()=>m.remove();m.onclick=e=>{if(e.target===m)m.remove()};return;
  }
  if(b.provider!=='r2')return toast('Proveedor de documento no compatible');
  if(!c.pdfGatewayUrl)return toast('Falta configurar la dirección del gateway PDF');
  const {data:{session}}=await db.auth.getSession();
  if(!session?.access_token)return login('Tu sesión expiró. Inicia sesión nuevamente.');
  if(!me?.id)return login('Debes iniciar sesión para leer documentos.');

  const gateway=c.pdfGatewayUrl.replace(/\/+$/,'')+'/pdf/'+encodeURIComponent(id);
  const safeName=(b.title||'documento').replace(/[\\/:*?"<>|]+/g,'_').trim()||'documento';
  const filename=(safeName.toLowerCase().endsWith('.pdf')?safeName:safeName+'.pdf').slice(0,180);
  const nativeLimit=128*1024*1024;
  const nativeMode=!b.sizeBytes||b.sizeBytes<=nativeLimit;
  const m=document.createElement('div');m.className='modal-bg';
  m.innerHTML='<section class="modal pdf-modal"><header><b>'+esc(b.title)+'</b><div class="pdf-tools"><a id="download-pdf" class="pdf-download" hidden>Descargar PDF</a><button id="close">Cerrar ×</button></div></header>'+(nativeMode?'<div class="pdf-native-wrap"><iframe id="pdf-frame" title="Documento PDF"></iframe></div>':'<div class="pdf-tools large-pdf-tools"><button id="prev" disabled>Anterior</button><span id="page-label">Cargando…</span><button id="next" disabled>Siguiente</button><button id="zoom-out">−</button><button id="zoom-in">+</button><button id="download-large">Descargar PDF</button></div><div class="pdf-scroll"><canvas id="pdf-canvas"></canvas></div>')+'<p class="pdf-status" id="pdf-status">Verificando sesión y permisos…</p></section>';
  document.body.append(m);
  let pdf=null,loadingTask=null,renderTask=null,objectUrl=null;
  const status=m.querySelector('#pdf-status'),download=m.querySelector('#download-pdf');
  const close=()=>{try{renderTask?.cancel()}catch{}try{loadingTask?.destroy()}catch{}if(objectUrl)URL.revokeObjectURL(objectUrl);m.remove()};
  m.querySelector('#close').onclick=close;m.onclick=e=>{if(e.target===m)close()};

  const recordRead=async()=>{if(live)await db.from('reading_events').insert({document_id:id,user_id:me.id,event_type:'opened'})};
  const streamDownload=async()=>{
    if(!window.showSaveFilePicker){
      toast('Para descargar este PDF grande, abrí la biblioteca en Chrome o Edge actualizado.');
      return;
    }
    try{
      const handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'Documento PDF',accept:{'application/pdf':['.pdf']}}]});
      status.textContent='Descargando PDF…';
      const response=await fetch(gateway,{headers:{Authorization:'Bearer '+session.access_token}});
      if(!response.ok)throw new Error((await response.text())||'No se pudo descargar el PDF.');
      if(!response.body)throw new Error('El navegador no permite recibir el archivo por streaming.');
      const writable=await handle.createWritable();
      await response.body.pipeTo(writable);
      status.textContent='Descarga completada.';
      toast('PDF descargado correctamente.');
    }catch(error){
      if(error?.name==='AbortError')return;
      console.error(error);status.textContent='No se pudo descargar el PDF. '+(error?.message||'');
    }
  };

  try{
    if(nativeMode){
      const response=await fetch(gateway,{headers:{Authorization:'Bearer '+session.access_token}});
      if(!response.ok)throw new Error((await response.text())||'No se pudo recuperar el PDF.');
      const blob=await response.blob();
      const signature=new Uint8Array(await blob.slice(0,5).arrayBuffer());
      if(signature.length!==5||new TextDecoder().decode(signature)!=='%PDF-')throw new Error('El servidor no devolvió un archivo PDF válido.');
      const pdfBlob=new Blob([blob],{type:'application/pdf'});
      objectUrl=URL.createObjectURL(pdfBlob);
      const frame=m.querySelector('#pdf-frame');
      frame.src=objectUrl;
      download.href=objectUrl;download.download=filename;download.hidden=false;
      status.textContent='PDF original abierto en el visor integrado del navegador. Podés buscar, imprimir o descargar desde sus controles.';
      await recordRead();
    }else{
      const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
      let pageNum=1,scale=1;
      const canvas=m.querySelector('#pdf-canvas'),ctx=canvas.getContext('2d'),label=m.querySelector('#page-label');
      const draw=async()=>{
        if(!pdf)return;
        if(renderTask){try{renderTask.cancel()}catch{}}
        const p=await pdf.getPage(pageNum),viewport=p.getViewport({scale}),dpr=window.devicePixelRatio||1;
        canvas.width=Math.floor(viewport.width*dpr);canvas.height=Math.floor(viewport.height*dpr);
        canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
        renderTask=p.render({canvasContext:ctx,viewport,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null});
        try{await renderTask.promise}catch(e){if(e?.name!=='RenderingCancelledException')throw e}
        label.textContent=pageNum+' / '+pdf.numPages;
        m.querySelector('#prev').disabled=pageNum<=1;m.querySelector('#next').disabled=pageNum>=pdf.numPages;
        status.textContent='Documento protegido · lectura por rangos';
      };
      m.querySelector('#prev').onclick=()=>{if(pageNum>1){pageNum--;draw().catch(e=>status.textContent=e.message)}};
      m.querySelector('#next').onclick=()=>{if(pdf&&pageNum<pdf.numPages){pageNum++;draw().catch(e=>status.textContent=e.message)}};
      m.querySelector('#zoom-in').onclick=()=>{scale=Math.min(3,scale+.2);draw().catch(e=>status.textContent=e.message)};
      m.querySelector('#zoom-out').onclick=()=>{scale=Math.max(.5,scale-.2);draw().catch(e=>status.textContent=e.message)};
      m.querySelector('#download-large').onclick=streamDownload;
      loadingTask=pdfjs.getDocument({url:gateway,httpHeaders:{Authorization:'Bearer '+session.access_token},withCredentials:false,disableAutoFetch:false,disableStream:false,rangeChunkSize:65536});
      pdf=await loadingTask.promise;
      await recordRead();
      await draw();
    }
  }catch(e){
    console.error(e);status.textContent='No se pudo abrir el documento. '+(e?.message||'Verifica tu sesión y permisos.');
    if(e?.status===401||e?.status===403)setTimeout(()=>{if(document.body.contains(m))login('Tu sesión expiró o no tienes permiso para este documento.')},900);
  }
}
function addUser(){let m=document.createElement('div');m.className='modal-bg';m.innerHTML='<section class="modal"><header><b>Crear usuario</b><button id="close">Cerrar</button></header><form id="new"><label>Nombre<input name="fullName" required></label><label>Email<input name="email" type="email" required></label><label>Contrasena temporal<input name="password" type="password" minlength="8" required></label><label>Rol<select name="role"><option value="reader">Lector</option><option value="editor">Editor</option><option value="admin">Administrador</option></select></label><button class="primary">Crear</button></form></section>';document.body.append(m);m.querySelector('#close').onclick=()=>m.remove();m.querySelector('#new').onsubmit=async e=>{e.preventDefault();let body=Object.fromEntries(new FormData(e.currentTarget));if(live){let {data,error}=await db.functions.invoke('admin-create-user',{body});if(error||!data?.email)return toast(error?.message||data?.error||'Error');toast('Usuario creado: '+data.email);m.remove();await loadUser(me)}else{users.push({name:body.fullName,email:body.email,role:body.role,status:'Demo temporal'});m.remove();render()}}}
async function signOut(){if(live)await db.auth.signOut();me=null;books=[];pendingDocs=[];users=[];collections=[];selectedFiles=[];role='reader';page='home';query='';favs.clear();history=[];login()}
if(live){let {data:{session}}=await db.auth.getSession();if(session)await loadUser(session.user);else login();db.auth.onAuthStateChange((_e,s)=>{if(!s&&me)login()})}else login();
