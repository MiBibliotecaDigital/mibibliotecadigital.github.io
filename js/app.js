import{createClient}from'https://esm.sh/@supabase/supabase-js@2';
const c=window.BIBLIOTECA_CONFIG||{},live=!!(c.supabaseUrl&&c.supabaseAnonKey&&c.demoMode===false),db=live?createClient(c.supabaseUrl,c.supabaseAnonKey):null,root=document.querySelector('#app');
let me=null,role='reader',page='home',query='',books=[],users=[],collections=[],favs=new Set(),history=[];
const sample=[['d1','Atlas del Archipielago Luminario','Elena Mar de Papel','Geografia imaginaria','atlas-luminario.pdf','sea'],['d2','Herbario de Arrecife Azul','Tomas del Invernadero','Naturaleza','herbario-arrecife-azul.pdf','leaf'],['d3','Cuaderno musical de Ciudad Resonante','Mara Afinacion','Musica','cuaderno-musica-ciudad.pdf','amber']].map(x=>({id:x[0],title:x[1],author:x[2],category:x[3],year:2026,pages:1,size:'PDF de muestra',provider:'demo',path:'/demo/pdfs/'+x[4],tone:x[5]}));
const demoUsers=[{name:'Administracion de prueba',email:'admin@biblioteca.local',role:'admin',status:'Activo'},{name:'Lector de ejemplo',email:'demo@biblioteca.local',role:'reader',status:'Activo'}];
const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),label=r=>r==='admin'?'Administrador':r==='editor'?'Editor':'Lector';
function toast(s){let n=document.createElement('div');n.className='toast';n.textContent=s;document.body.append(n);setTimeout(()=>n.remove(),2800)}
function login(msg=''){root.innerHTML='<div class="demo-strip">'+(live?'ACCESO PRIVADO · SUPABASE':'MODO DEMOSTRACION · USUARIOS FICTICIOS')+'</div><main class="login"><section class="art" aria-hidden="true"><div class="brand"><b>B</b></div></section><section class="login-side"><form id="login"><div class="mark">B</div><h2>Bienvenido</h2><p>Ingresa para continuar a tu biblioteca.</p>'+(msg?'<div class="notice">'+esc(msg)+'</div>':'')+'<label>Correo electronico<input name="email" type="email" required></label><label>Contrasena<input name="password" type="password" required></label><button class="primary">Ingresar →</button>'+(live?'':'<div class="demo-box"><b>CUENTAS FICTICIAS</b>Administrador: admin@biblioteca.local <code>admin1234</code>Lector: demo@biblioteca.local <code>demo1234</code><small>Solo para probar la interfaz. No son cuentas reales ni protegen datos privados.</small></div>')+'</form></section></main>';document.querySelector('#login').onsubmit=signIn}
async function signIn(e){e.preventDefault();let f=new FormData(e.currentTarget),email=String(f.get('email')).toLowerCase(),password=String(f.get('password'));if(!live){let a=email==='admin@biblioteca.local'&&password==='admin1234'?['Administracion de prueba','admin']:email==='demo@biblioteca.local'&&password==='demo1234'?['Lector de ejemplo','reader']:null;if(!a)return login('Credenciales incorrectas. Usa las cuentas de prueba.');me={email,name:a[0]};role=a[1];books=sample;users=demoUsers;return render()}let {data,error}=await db.auth.signInWithPassword({email,password});if(error)return login(error.message);await loadUser(data.user)}
async function loadUser(u){let {data:p,error}=await db.from('profiles').select('full_name,role,status').eq('id',u.id).single();if(error||!p||p.status!=='active'){await db.auth.signOut();return login('Cuenta sin perfil activo.')}me={id:u.id,email:u.email,name:p.full_name||u.email};role=p.role;let {data:d,error:de}=await db.from('documents').select('id,title,authors,publication_year,category,page_count,size_bytes,provider,demo_path').eq('is_published',true).order('title');if(de){books=[];toast(de.message)}else books=(d||[]).map((x,i)=>({id:x.id,title:x.title,author:(x.authors||[]).join(', '),year:x.publication_year||'s/f',category:x.category,pages:x.page_count||'—',size:x.size_bytes?Math.round(x.size_bytes/1024)+' KB':'—',provider:x.provider,path:x.demo_path||'',tone:['sea','leaf','amber'][i%3]}));if(role==='admin'){let {data:cs}=await db.from('collections').select('id,name').order('name');collections=cs||[];let {data:ps}=await db.from('profiles').select('id,full_name,role,status').order('created_at',{ascending:false});users=(ps||[]).map(x=>({name:x.full_name,email:x.id,role:x.role,status:x.status==='active'?'Activo':'Suspendido'}))}else collections=[];render();
  const pendingDocument=new URLSearchParams(window.location.search).get('open');
  if(pendingDocument){
    const cleanUrl=new URL(window.location.href);cleanUrl.searchParams.delete('open');
    window.history.replaceState({},'',cleanUrl.pathname+cleanUrl.search+cleanUrl.hash);
    if(books.some(x=>x.id===pendingDocument))setTimeout(()=>openBook(pendingDocument),0);
    else setTimeout(()=>toast('El documento solicitado no está disponible para esta cuenta.'),0);
  }
}
function nav(p,t){return '<button class="nav '+(page===p?'active':'')+'" data-page="'+p+'">'+t+'</button>'}
function card(b){return '<article class="book"><div class="cover '+b.tone+'"><small>MI BIBLIOTECA · PDF</small><strong>'+esc(b.title)+'</strong><span>'+esc(b.author)+'</span></div><div class="info"><em>'+esc(b.category)+'</em><h3>'+esc(b.title)+'</h3><p>'+esc(b.author)+' · '+esc(b.year)+'</p><footer><button class="fav" data-fav="'+esc(b.id)+'">'+(favs.has(b.id)?'♥':'♡')+'</button><small>'+esc(b.size)+'</small><button data-open="'+esc(b.id)+'">Leer PDF</button></footer></div></article>'}
function filtered(){return books.filter(b=>(page!=='favorites'||favs.has(b.id))&&(!query||(b.title+' '+b.author+' '+b.category).toLowerCase().includes(query.toLowerCase())))}
function uploadPage(){return '<div class="heading"><div><h1>Cargar documento</h1><p>El archivo se guarda en el bucket privado y se incorpora al catálogo.</p></div></div><form class="panel upload-panel" id="upload-form"><div class="upload-grid"><label>Título<input name="title" maxlength="300" required placeholder="Título del libro"></label><label>Autor/es<input name="authors" maxlength="1000" placeholder="Separar varios autores con coma"></label><label>Categoría<input name="category" maxlength="100" required value="General"></label><label>Año de publicación<input name="publicationYear" type="number" min="1000" max="2100" placeholder="Opcional"></label><label>Colección<select name="collectionId"><option value="">Sin colección</option>'+collections.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+'</select></label><label class="upload-file">Archivo PDF<input name="file" type="file" accept=".pdf,application/pdf" required></label></div><label>Descripción<textarea name="description" maxlength="3000" rows="3" placeholder="Descripción opcional"></textarea></label><div class="upload-note">PDF hasta 2 GiB. La transferencia se realiza en fragmentos de 10 MiB y el documento se publica cuando termina correctamente.</div><button class="primary" id="upload-submit">Subir PDF a la biblioteca</button><div class="upload-progress" id="upload-progress" hidden><progress max="100" value="0"></progress><span id="upload-status" role="status">Preparando...</span></div></form>'}
async function uploadDocument(e){
  e.preventDefault();
  if(role!=='admin'||!live)return toast('Solo el administrador puede cargar documentos.');
  const form=e.currentTarget,data=new FormData(form),file=data.get('file');
  if(!(file instanceof File)||!file.size)return toast('Selecciona un archivo PDF.');
  if(!/\.pdf$/i.test(file.name)|| (file.type&&file.type!=='application/pdf'))return toast('El archivo debe tener formato PDF.');
  if(file.size>2*1024*1024*1024)return toast('El tamaño máximo actual es 2 GiB.');
  const {data:{session}}=await db.auth.getSession();
  if(!session?.access_token)return login('Tu sesión expiró. Inicia sesión nuevamente.');
  const base=(c.pdfGatewayUrl||'').replace(/\/+$/,'');
  if(!base)return toast('Falta configurar el gateway PDF.');
  const button=form.querySelector('#upload-submit'),progress=form.querySelector('#upload-progress'),bar=progress.querySelector('progress'),status=form.querySelector('#upload-status');
  button.disabled=true;progress.hidden=false;
  let upload=null;
  const show=(message,percent)=>{status.textContent=message;if(percent!==undefined)bar.value=percent};
  const abort=async()=>{if(!upload)return;const url=new URL(base+'/upload/abort');url.searchParams.set('key',upload.key);url.searchParams.set('uploadId',upload.uploadId);try{await fetch(url,{method:'DELETE',headers:{Authorization:'Bearer '+session.access_token}})}catch{}};
  try{
    show('Comprobando permisos y preparando el espacio privado...',0);
    const start=await fetch(base+'/upload/start',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'X-File-Size':String(file.size)}});
    if(!start.ok)throw new Error(await start.text()||'No se pudo iniciar la carga.');
    upload=await start.json();
    const parts=[];let offset=0,partNumber=1;
    while(offset<file.size){
      const end=Math.min(offset+upload.partSize,file.size),chunk=file.slice(offset,end);
      show('Subiendo fragmento '+partNumber+' · '+Math.round(offset/file.size*100)+'%',Math.round(offset/file.size*100));
      const url=new URL(base+'/upload/part');url.searchParams.set('key',upload.key);url.searchParams.set('uploadId',upload.uploadId);url.searchParams.set('partNumber',String(partNumber));
      const response=await fetch(url,{method:'PUT',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/octet-stream'},body:chunk});
      if(!response.ok)throw new Error(await response.text()||'Falló el fragmento '+partNumber+'.');
      parts.push(await response.json());offset=end;partNumber++;
    }
    show('Verificando el PDF y agregándolo al catálogo...',96);
    const metadata={
      title:String(data.get('title')||'').trim(),
      authors:String(data.get('authors')||'').trim(),
      category:String(data.get('category')||'General').trim(),
      publicationYear:String(data.get('publicationYear')||''),
      description:String(data.get('description')||'').trim(),
      collectionId:String(data.get('collectionId')||'')||null
    };
    const complete=await fetch(base+'/upload/complete',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({key:upload.key,uploadId:upload.uploadId,parts,fileSize:file.size,metadata})});
    if(!complete.ok)throw new Error(await complete.text()||'No se pudo finalizar la carga.');
    const result=await complete.json();upload=null;
    show('Documento incorporado correctamente.',100);
    toast('PDF agregado: '+(result.document?.title||metadata.title));
    page='catalog';query='';await loadUser(me);
  }catch(error){
    await abort();
    show(error?.message||'No se pudo completar la carga.');
    button.disabled=false;
  }
}
function usersPage(){return '<div class="heading"><div><h1>Usuarios</h1><p>Administracion de cuentas y privilegios.</p></div><button class="primary" id="add">+ Crear usuario</button></div>'+(live?'':'<div class="notice">Usuarios ficticios; no se crean cuentas reales en modo demo.</div>')+'<div class="panel"><h2>Cuentas registradas</h2><table><tr><th>Usuario</th><th>Privilegio</th><th>Estado</th></tr>'+users.map(u=>'<tr><td>'+esc(u.name)+'<small>'+esc(u.email)+'</small></td><td>'+label(u.role)+'</td><td>'+esc(u.status)+'</td></tr>').join('')+'</table></div>'}
function content(){if(page==='upload'&&role==='admin')return uploadPage();if(page==='users'&&role==='admin')return usersPage();if(page==='settings')return '<div class="heading"><h1>Configuracion</h1></div><div class="panel"><h2>Supabase</h2><p>'+(live?'Autenticacion conectada.':'Modo demo; falta configurar credenciales.')+'</p><h2>Cloudflare R2</h2><p>Bucket privado biblioteca-digital-archivos. Falta configurar secretos y desplegar funciones.</p><h2>Seguridad</h2><p>No subir libros reales hasta completar la configuracion del backend.</p></div>';let list=filtered(),title=page==='favorites'?'Mis favoritos':page==='catalog'?'Todos los libros':page==='collections'?'Colecciones':'Tu biblioteca, a mano.';return '<div class="heading"><div><h1>'+title+'</h1><p>Hola, '+esc(me.name)+'. Tu coleccion organizada en un solo lugar.</p></div><span class="tag">'+list.length+' documentos</span></div>'+(page==='home'?'<div class="stats"><div>Documentos<b>'+books.length+'</b></div><div>Colecciones<b>3</b></div><div>Favoritos<b>'+favs.size+'</b></div><div>Lecturas<b>'+history.length+'</b></div></div>':'')+'<div class="chips"><button data-cat="all">Todos</button><button data-cat="Geografia imaginaria">Geografia</button><button data-cat="Naturaleza">Naturaleza</button><button data-cat="Musica">Musica</button></div><div class="grid">'+list.map(card).join('')+'</div><p class="footnote">'+(live?'Acceso a documentos autorizados por tu cuenta.':'Los PDF son ficticios y publicos, solo para probar la interfaz.')+'</p>'}
function render(){root.innerHTML=(live?'':'<div class="demo-strip">MODO DEMOSTRACION · sin autenticacion real</div>')+'<aside class="sidebar"><div class="brand"><b>B</b> MI BIBLIOTECA</div><small>BIBLIOTECA</small>'+nav('home','⌂ Resumen')+nav('catalog','▤ Todos los libros')+nav('favorites','♡ Favoritos')+nav('collections','▦ Colecciones')+(role==='admin'?'<small>GESTION</small>'+nav('users','♙ Usuarios')+nav('settings','⚙ Configuracion')+nav('upload','＋ Cargar PDF'):'')+'<div class="side-bottom"><b>'+esc(me.name)+'</b><small>'+label(role)+'</small><button id="logout">Cerrar sesion ↗</button></div></aside><main class="main"><header><span>Mi Biblioteca / '+esc(page)+'</span><input id="search" placeholder="Buscar titulo, autor..." value="'+esc(query)+'"><b>'+esc(me.name)+'</b></header><section class="page">'+content()+'</section></main>';document.querySelectorAll('[data-page]').forEach(x=>x.onclick=()=>{page=x.dataset.page;render()});document.querySelector('#logout').onclick=signOut;document.querySelector('#search').oninput=e=>{query=e.target.value;let g=document.querySelector('.grid');if(g)g.innerHTML=filtered().map(card).join('');bindBooks()};document.querySelectorAll('[data-cat]').forEach(x=>x.onclick=()=>{page='catalog';query=x.dataset.cat==='all'?'':x.dataset.cat;render()});document.querySelector('#add')?.addEventListener('click',addUser);document.querySelector('#upload-form')?.addEventListener('submit',uploadDocument);bindBooks()}
function bindBooks(){document.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>openBook(x.dataset.open));document.querySelectorAll('[data-fav]').forEach(x=>x.onclick=()=>{favs.has(x.dataset.fav)?favs.delete(x.dataset.fav):favs.add(x.dataset.fav);render()})}
async function openBook(id){
  const b=books.find(x=>x.id===id);if(!b)return;
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
  const m=document.createElement('div');m.className='modal-bg';
  m.innerHTML='<section class="modal pdf-modal"><header><b>'+esc(b.title)+'</b><div class="pdf-tools"><button id="prev" disabled>Anterior</button><span id="page-label">Cargando…</span><button id="next" disabled>Siguiente</button><button id="zoom-out">−</button><button id="zoom-in">+</button><button id="close">Cerrar ×</button></div></header><div class="pdf-scroll"><canvas id="pdf-canvas"></canvas></div><p class="pdf-status" id="pdf-status">Verificando sesión y permisos…</p></section>';
  document.body.append(m);
  const close=()=>{try{loadingTask?.destroy()}catch{}m.remove()};
  m.querySelector('#close').onclick=close;m.onclick=e=>{if(e.target===m)close()};
  let pdf=null,pageNum=1,scale=1,loadingTask=null,renderTask=null;
  const canvas=m.querySelector('#pdf-canvas'),ctx=canvas.getContext('2d'),status=m.querySelector('#pdf-status'),label=m.querySelector('#page-label');
  const draw=async()=>{
    if(!pdf)return;
    if(renderTask){try{renderTask.cancel()}catch{}}
    const p=await pdf.getPage(pageNum),viewport=p.getViewport({scale});
    const dpr=window.devicePixelRatio||1;
    canvas.width=Math.floor(viewport.width*dpr);canvas.height=Math.floor(viewport.height*dpr);
    canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
    renderTask=p.render({canvasContext:ctx,viewport,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null});
    try{await renderTask.promise}catch(e){if(e?.name!=='RenderingCancelledException')throw e}
    label.textContent=pageNum+' / '+pdf.numPages;
    m.querySelector('#prev').disabled=pageNum<=1;m.querySelector('#next').disabled=pageNum>=pdf.numPages;
    status.textContent='Documento protegido · sesión verificada';
  };
  m.querySelector('#prev').onclick=()=>{if(pageNum>1){pageNum--;draw().catch(e=>status.textContent=e.message)}};
  m.querySelector('#next').onclick=()=>{if(pdf&&pageNum<pdf.numPages){pageNum++;draw().catch(e=>status.textContent=e.message)}};
  m.querySelector('#zoom-in').onclick=()=>{scale=Math.min(3,scale+.2);draw().catch(e=>status.textContent=e.message)};
  m.querySelector('#zoom-out').onclick=()=>{scale=Math.max(.5,scale-.2);draw().catch(e=>status.textContent=e.message)};
  try{
    const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    const gateway=c.pdfGatewayUrl.replace(/\/+$/,'')+'/pdf/'+encodeURIComponent(id);
    loadingTask=pdfjs.getDocument({url:gateway,httpHeaders:{Authorization:'Bearer '+session.access_token},withCredentials:false,disableAutoFetch:false,disableStream:false,rangeChunkSize:65536});
    pdf=await loadingTask.promise;
    if(live)await db.from('reading_events').insert({document_id:id,user_id:me.id,event_type:'opened'});
    await draw();
  }catch(e){
    console.error(e);status.textContent='No se pudo abrir el documento. '+(e?.message||'Verifica tu sesión y permisos.');
    if(e?.status===401||e?.status===403)setTimeout(()=>{if(document.body.contains(m))login('Tu sesión expiró o no tienes permiso para este documento.')},900);
  }
}
function addUser(){let m=document.createElement('div');m.className='modal-bg';m.innerHTML='<section class="modal"><header><b>Crear usuario</b><button id="close">Cerrar</button></header><form id="new"><label>Nombre<input name="fullName" required></label><label>Email<input name="email" type="email" required></label><label>Contrasena temporal<input name="password" type="password" minlength="8" required></label><label>Rol<select name="role"><option value="reader">Lector</option><option value="editor">Editor</option><option value="admin">Administrador</option></select></label><button class="primary">Crear</button></form></section>';document.body.append(m);m.querySelector('#close').onclick=()=>m.remove();m.querySelector('#new').onsubmit=async e=>{e.preventDefault();let body=Object.fromEntries(new FormData(e.currentTarget));if(live){let {data,error}=await db.functions.invoke('admin-create-user',{body});if(error||!data?.email)return toast(error?.message||data?.error||'Error');toast('Usuario creado: '+data.email);m.remove();await loadUser(me)}else{users.push({name:body.fullName,email:body.email,role:body.role,status:'Demo temporal'});m.remove();render()}}}
async function signOut(){if(live)await db.auth.signOut();me=null;books=[];users=[];role='reader';page='home';query='';favs.clear();history=[];login()}
if(live){let {data:{session}}=await db.auth.getSession();if(session)await loadUser(session.user);else login();db.auth.onAuthStateChange((_e,s)=>{if(!s&&me)login()})}else login();
