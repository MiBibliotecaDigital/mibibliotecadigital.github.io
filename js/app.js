import{createClient}from'https://esm.sh/@supabase/supabase-js@2';
const c=window.BIBLIOTECA_CONFIG||{},live=!!(c.supabaseUrl&&c.supabaseAnonKey&&c.demoMode===false),db=live?createClient(c.supabaseUrl,c.supabaseAnonKey):null,root=document.querySelector('#app');
let me=null,role='reader',page='home',query='',books=[],pendingDocs=[],users=[],collections=[],selectedFiles=[],uploadInProgress=false,metadataInProgress=false,metadataQueueProgress={done:0,total:0,failed:0},favs=new Set(),history=[],sortBy='title',sortDir='asc',viewMode='grid',density=3,filterCollection='',filterCategory='',bookAdminStatus='all';
const sample=[['d1','Atlas del Archipielago Luminario','Elena Mar de Papel','Geografia imaginaria','atlas-luminario.pdf','sea'],['d2','Herbario de Arrecife Azul','Tomas del Invernadero','Naturaleza','herbario-arrecife-azul.pdf','leaf'],['d3','Cuaderno musical de Ciudad Resonante','Mara Afinacion','Musica','cuaderno-musica-ciudad.pdf','amber']].map(x=>({id:x[0],title:x[1],author:x[2],category:x[3],year:2026,pages:1,size:'PDF de muestra',provider:'demo',path:'/demo/pdfs/'+x[4],tone:x[5]}));
const demoUsers=[{name:'Administracion de prueba',email:'admin@biblioteca.local',role:'admin',status:'Activo'},{name:'Lector de ejemplo',email:'demo@biblioteca.local',role:'reader',status:'Activo'}];
const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),label=r=>r==='admin'?'Administrador':r==='editor'?'Editor':'Lector';
function toast(s){let n=document.createElement('div');n.className='toast';n.textContent=s;document.body.append(n);setTimeout(()=>n.remove(),2800)}
function login(msg=''){window.__BIBLIOTECA_READY__=true;root.innerHTML='<div class="demo-strip">'+(live?'ACCESO PRIVADO · SUPABASE':'MODO DEMOSTRACION · USUARIOS FICTICIOS')+'</div><main class="login"><section class="art" aria-hidden="true"><div class="brand"><b>B</b></div></section><section class="login-side"><form id="login"><div class="mark">B</div><h2>Bienvenido</h2><p>Ingresa para continuar a tu biblioteca.</p>'+(msg?'<div class="notice">'+esc(msg)+'</div>':'')+'<label>Correo o nombre de usuario<input name="email" type="text" autocomplete="username" required></label><label>Contrasena<input name="password" type="password" autocomplete="current-password" required></label><button class="primary">Ingresar →</button>'+(live?'':'<div class="demo-box"><b>CUENTAS FICTICIAS</b>Administrador: admin@biblioteca.local <code>admin1234</code>Lector: demo@biblioteca.local <code>demo1234</code><small>Solo para probar la interfaz. No son cuentas reales ni protegen datos privados.</small></div>')+'</form></section></main>';document.querySelector('#login').onsubmit=signIn}
async function signIn(e){e.preventDefault();let f=new FormData(e.currentTarget),email=String(f.get('email')).toLowerCase(),password=String(f.get('password'));if(!live){let a=email==='admin@biblioteca.local'&&password==='admin1234'?['Administracion de prueba','admin']:email==='demo@biblioteca.local'&&password==='demo1234'?['Lector de ejemplo','reader']:null;if(!a)return login('Credenciales incorrectas. Usa las cuentas de prueba.');me={email,name:a[0]};role=a[1];books=sample;users=demoUsers;return render()}let data,error;if(email.includes('@')){({data,error}=await db.auth.signInWithPassword({email,password}));if(error)return login(error.message);await loadUser(data.user)}else{const result=await db.functions.invoke('username-login',{body:{username:email,password}});if(result.error)return login('Usuario o contraseña incorrectos.');const session=result.data;if(!session?.access_token||!session?.refresh_token)return login('Respuesta de acceso no válida.');const saved=await db.auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token});if(saved.error)return login(saved.error.message);await loadUser(saved.data.user)}}
async function loadUser(u){let {data:p,error}=await db.from('profiles').select('full_name,username,role,status').eq('id',u.id).single();if(error||!p||p.status!=='active'){await db.auth.signOut();return login('Cuenta sin perfil activo.')}me={id:u.id,email:u.email,username:p.username||'',name:p.full_name||u.email};role=p.role;let docQuery=db.from('documents').select('id,title,authors,publication_year,category,page_count,size_bytes,provider,demo_path,is_published,description,collection_id,tags,isbn,publisher,metadata_source,metadata_reviewed,upload_status,metadata_status,metadata_error,original_filename,uploaded_by').order('title');if(role!=='admin')docQuery=docQuery.eq('is_published',true);let {data:d,error:de}=await docQuery;if(de){books=[];pendingDocs=[];toast(de.message)}else{const rows=d||[];const mapDoc=(x,i)=>({id:x.id,title:x.title,author:(x.authors||[]).join(', '),authors:x.authors||[],year:x.publication_year||'',category:x.category||'General',pages:x.page_count||'—',pageCount:x.page_count||0,size:x.size_bytes?Math.round(x.size_bytes/1024)+' KB':'—',sizeBytes:x.size_bytes||0,provider:x.provider,path:x.demo_path||'',description:x.description||'',collectionId:x.collection_id||'',tags:x.tags||[],isbn:x.isbn||'',publisher:x.publisher||'',metadataSource:x.metadata_source||'filename',metadataReviewed:!!x.metadata_reviewed,uploadStatus:x.upload_status||'stored',metadataStatus:x.metadata_status||'pending',metadataError:x.metadata_error||'',originalFilename:x.original_filename||'',uploadedBy:x.uploaded_by||null,tone:['sea','leaf','amber'][i%3]});books=rows.filter(x=>x.is_published).map(mapDoc);pendingDocs=role==='admin'?rows.filter(x=>!x.is_published).map(mapDoc):[];}let {data:cs}=await db.from('collections').select('id,name,description').order('name');collections=cs||[];if(role==='admin'){const {data:ud,error:ue}=await db.functions.invoke('admin-users',{body:{action:'list'}});if(ue){users=[];let detail=ue.message||'Error desconocido';try{const payload=await ue.context?.json?.();if(payload?.error)detail=payload.error}catch{}toast('No se pudo cargar la lista de usuarios: '+detail)}else users=ud?.users||[]}else users=[];render();
  const pendingDocument=new URLSearchParams(window.location.search).get('open');
  if(pendingDocument){
    const cleanUrl=new URL(window.location.href);cleanUrl.searchParams.delete('open');
    window.history.replaceState({},'',cleanUrl.pathname+cleanUrl.search+cleanUrl.hash);
    if(books.some(x=>x.id===pendingDocument)||pendingDocs.some(x=>x.id===pendingDocument))setTimeout(()=>openBook(pendingDocument),0);
    else setTimeout(()=>toast('El documento solicitado no está disponible para esta cuenta.'),0);
  }
}
function nav(p,t){return '<button class="nav '+(page===p?'active':'')+'" data-page="'+p+'">'+t+'</button>'}
function card(b){return '<article class="book '+(viewMode==='list'?'book-list-item':'')+'"><div class="cover '+b.tone+'"><small>PDF</small><strong>'+esc(b.title)+'</strong><span>'+esc(b.author||'Autor no indicado')+'</span></div><div class="info"><em>'+esc(b.category)+'</em><h3>'+esc(b.title)+'</h3><p>'+esc(b.author||'Autor no indicado')+' · '+esc(b.year||'Año sin indicar')+(b.pages&&b.pages!=='—'?' · '+esc(b.pages)+' págs.':'')+'</p><p class="book-tags">'+(b.tags||[]).map(t=>'<span>'+esc(t)+'</span>').join('')+'</p><footer><button class="fav" data-fav="'+esc(b.id)+'">'+(favs.has(b.id)?'♥':'♡')+'</button><small>'+esc(b.size)+'</small><button data-open="'+esc(b.id)+'">Abrir PDF</button>'+(role==='admin'?'<button class="small-action" data-edit-book="'+esc(b.id)+'">Editar</button><button class="small-action danger" data-delete-book="'+esc(b.id)+'">Eliminar</button>':'')+'</footer></div></article>'}
function filtered(){let out=books.filter(b=>(page!=='favorites'||favs.has(b.id))&&(!query||(b.title+' '+b.author+' '+b.category+' '+(b.tags||[]).join(' ')).toLowerCase().includes(query.toLowerCase()))&&(!filterCollection||b.collectionId===filterCollection)&&(!filterCategory||b.category===filterCategory||(b.tags||[]).includes(filterCategory)));out.sort((a,b)=>{if(sortBy==='title'){const c=(a.title||'').localeCompare(b.title||'','es',{sensitivity:'base'});return sortDir==='asc'?c:-c}const av=sortBy==='year'?Number(a.year):Number(a.pageCount),bv=sortBy==='year'?Number(b.year):Number(b.pageCount),am=!Number.isFinite(av)||av<=0,bm=!Number.isFinite(bv)||bv<=0;if(am!==bm)return am?1:-1;const c=av-bv;return sortDir==='asc'?c:-c});return out}
function uploadPage(){return '<div class="heading"><div><h1>Subir PDFs</h1><p>Seleccioná varios archivos. Se guardan como borradores privados y se analizan automáticamente.</p></div></div><form class="panel upload-panel" id="upload-form"><label class="upload-drop" id="upload-drop" for="upload-files"><strong>Elegí o arrastrá varios archivos PDF</strong><span>Sin límite artificial de archivos por tanda · 2 GiB por archivo</span><input id="upload-files" name="files" type="file" accept=".pdf,application/pdf" multiple required></label><div id="upload-file-list" class="upload-file-list"><span class="muted">Todavía no seleccionaste archivos.</span></div><div class="upload-note"><b>Etapa 1 · Guardado:</b> los PDFs se suben y registran en el catálogo como borradores privados. La subida usa hasta 3 archivos simultáneos. Un fallo posterior de metadatos no elimina el archivo.</div><div class="upload-note"><b>Etapa 2 · Metadatos:</b> al terminar todas las cargas, PDF.js analiza los documentos en el navegador con hasta 3 análisis simultáneos. Se puede interrumpir y reanudar desde Administrar libros; los PDFs ya guardados permanecen disponibles.</div><div class="upload-note">Al terminar, se extraen automáticamente propiedades y texto del PDF. Cuando se detecta un ISBN, se consultan catálogos bibliográficos externos para completar título, autores, editorial, año, temas y descripción. Cada ficha queda como borrador privado para que puedas revisarla en Administrar libros. Los archivos escaneados sin texto pueden necesitar corrección manual.</div><div class="upload-note">La detección de duplicados compara huellas exactas con documentos de esta biblioteca y coincidencias bibliográficas por ISBN o título/autor. No rastrea todos los sitios de Internet.</div><button class="primary" id="upload-submit" type="submit" disabled>Subir PDFs seleccionados</button><div id="upload-results" class="upload-results" aria-live="polite"></div></form>'}
function renderUploadSelection(){
  const list=document.querySelector('#upload-file-list'),button=document.querySelector('#upload-submit');
  if(!list||!button)return;
  const total=selectedFiles.reduce((n,f)=>n+f.size,0);
  list.innerHTML=selectedFiles.length?'<div class="upload-selection-summary">'+selectedFiles.length+' archivo(s) · '+(total/1024/1024).toFixed(1)+' MiB</div>'+selectedFiles.map((f,i)=>'<div class="upload-file-row"><span>'+esc(f.name)+'</span><small>'+Math.ceil(f.size/1024)+' KiB</small></div>').join(''):'<span class="muted">Todavía no seleccionaste archivos.</span>';
  button.disabled=uploadInProgress||!selectedFiles.length;
  button.textContent=uploadInProgress?'Procesando tanda…':selectedFiles.length?'Subir '+selectedFiles.length+' PDF(s)':'Subir PDFs seleccionados';
  const input=document.querySelector('#upload-files');if(input)input.disabled=uploadInProgress;
}
async function fingerprintFile(file,onProgress){
  const chunkSize=16*1024*1024,parts=[];
  for(let offset=0;offset<file.size;offset+=chunkSize){
    const bytes=await file.slice(offset,Math.min(offset+chunkSize,file.size)).arrayBuffer();
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    parts.push(Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''));
    onProgress?.(Math.round(Math.min(offset+chunkSize,file.size)/file.size*100));
  }
  const canonical='MiBibliotecaDigital:file-fingerprint:v1:'+file.size+':'+chunkSize+':'+parts.join('');
  const finalDigest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(finalDigest),b=>b.toString(16).padStart(2,'0')).join('');
}
async function fingerprintResponseStream(response,expectedSize){
  if(!response.ok||!response.body)throw new Error('No se pudo leer un PDF existente para verificar duplicados.');
  const chunkSize=16*1024*1024,buffer=new Uint8Array(chunkSize),parts=[];
  const reader=response.body.getReader();let position=0,total=0;
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      let offset=0;total+=value.byteLength;
      while(offset<value.byteLength){
        const count=Math.min(chunkSize-position,value.byteLength-offset);
        buffer.set(value.subarray(offset,offset+count),position);
        position+=count;offset+=count;
        if(position===chunkSize){
          const digest=await crypto.subtle.digest('SHA-256',buffer);
          parts.push(Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''));
          position=0;
        }
      }
    }
  }finally{reader.releaseLock()}
  if(total!==expectedSize)throw new Error('La lectura del PDF existente no coincide con su tamaño registrado.');
  if(position){
    const digest=await crypto.subtle.digest('SHA-256',buffer.slice(0,position));
    parts.push(Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''));
  }
  const canonical='MiBibliotecaDigital:file-fingerprint:v1:'+total+':'+chunkSize+':'+parts.join('');
  const finalDigest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(finalDigest),b=>b.toString(16).padStart(2,'0')).join('');
}
async function ensureLibraryFingerprintIndex(token,onProgress){
  const {data:missing,error}=await db.from('documents')
    .select('id,title,size_bytes')
    .eq('provider','r2')
    .is('file_fingerprint',null)
    .order('created_at',{ascending:true});
  if(error)throw error;
  const docs=missing||[];
  for(let i=0;i<docs.length;i++){
    const doc=docs[i];
    onProgress?.(doc,i+1,docs.length,0);
    const base=(c.pdfGatewayUrl||'').replace(/\/+$/,'');
    const response=await fetch(base+'/pdf/'+encodeURIComponent(doc.id),{headers:{Authorization:'Bearer '+token}});
    const fingerprint=await fingerprintResponseStream(response,Number(doc.size_bytes));
    const {error:updateError}=await db.from('documents').update({file_fingerprint:fingerprint}).eq('id',doc.id);
    if(updateError)throw updateError;
    onProgress?.(doc,i+1,docs.length,100);
  }
  return docs.length;
}
async function findExactDuplicates(fingerprint){
  const {data,error}=await db.from('documents').select('id,title,authors,isbn,is_published,file_fingerprint')
    .eq('file_fingerprint',fingerprint).limit(10);
  if(error)throw error;
  return data||[];
}
function askDuplicateChoice(file,matches){
  return new Promise(resolve=>{
    const modal=document.createElement('div');modal.className='modal-bg';
    modal.innerHTML='<section class="modal duplicate-modal"><header><b>PDF posiblemente duplicado</b><button id="duplicate-close" type="button">Cerrar ×</button></header><p>Ya existe '+(matches.length===1?'un documento':'documentos')+' con exactamente los mismos bytes que <b>'+esc(file.name)+'</b>:</p><ul>'+matches.map(x=>'<li>'+esc(x.title||'Sin título')+'</li>').join('')+'</ul><p class="muted">Puede ser una copia accidental o una versión que querés conservar por separado.</p><div class="metadata-actions"><button class="secondary" id="duplicate-skip" type="button">Omitir este PDF</button><button class="primary" id="duplicate-continue" type="button">Subir igualmente como libro diferente</button></div></section>';
    document.body.append(modal);
    const finish=value=>{modal.remove();resolve(value)};
    modal.querySelector('#duplicate-close').onclick=()=>finish(false);
    modal.querySelector('#duplicate-skip').onclick=()=>finish(false);
    modal.querySelector('#duplicate-continue').onclick=()=>finish(true);
    modal.onclick=e=>{if(e.target===modal)finish(false)};
  });
}
async function uploadOneFile(file,token,onProgress,fileFingerprint){
  const base=(c.pdfGatewayUrl||'').replace(/\/+$/,'');
  const auth={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  let upload=null;
  const abort=async()=>{
    if(!upload)return null;
    const url=new URL(base+'/upload/abort');
    url.searchParams.set('key',upload.key);
    url.searchParams.set('uploadId',upload.uploadId);
    url.searchParams.set('documentId',upload.documentId);
    try{
      const response=await fetch(url,{method:'DELETE',headers:{Authorization:'Bearer '+token}});
      return response.ok?await response.json().catch(()=>null):null;
    }catch{return null}
  };
  try{
    const start=await fetch(base+'/upload/start',{
      method:'POST',headers:auth,
      body:JSON.stringify({fileSize:file.size,fileName:file.name.slice(0,255),fileFingerprint})
    });
    if(!start.ok)throw new Error((await start.text())||'No se pudo iniciar la carga.');
    upload=await start.json();
    if(!upload?.key||!upload?.uploadId||!upload?.documentId||!Number(upload.partSize))
      throw new Error('El servidor devolvió datos de carga incompletos.');
    const parts=[];let offset=0,partNumber=1;
    while(offset<file.size){
      const end=Math.min(offset+upload.partSize,file.size),chunk=file.slice(offset,end);
      const url=new URL(base+'/upload/part');
      url.searchParams.set('key',upload.key);
      url.searchParams.set('uploadId',upload.uploadId);
      url.searchParams.set('partNumber',String(partNumber));
      const response=await fetch(url,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body:chunk});
      if(!response.ok)throw new Error((await response.text())||'Falló el fragmento '+partNumber+'.');
      parts.push(await response.json());offset=end;partNumber++;
      onProgress?.(Math.round(offset/file.size*100));
    }
    const complete=await fetch(base+'/upload/complete',{
      method:'POST',
      headers:auth,
      body:JSON.stringify({key:upload.key,uploadId:upload.uploadId,documentId:upload.documentId,parts,fileSize:file.size,fileName:file.name.slice(0,255),fileFingerprint})
    });
    if(!complete.ok)throw new Error((await complete.text())||'No se pudo finalizar la carga.');
    const result=await complete.json();upload=null;
    return {id:result.documentId||result.document?.id,title:file.name,catalogueSynced:result.catalogueSynced!==false};
  }catch(error){
    const recovered=await abort();
    if(recovered?.stored&&recovered?.documentId)
      return {id:recovered.documentId,title:file.name,catalogueSynced:recovered.catalogueSynced!==false};
    throw error;
  }
}
function askBibliographicDuplicateChoice(file,matches){
  return new Promise(resolve=>{
    const modal=document.createElement('div');modal.className='modal-bg';
    modal.innerHTML='<section class="modal duplicate-modal"><header><b>Coincidencia bibliográfica</b><button id="bib-duplicate-close" type="button">Cerrar ×</button></header><p>El análisis encontró un libro existente que podría ser el mismo que <b>'+esc(file.name)+'</b>:</p><ul>'+matches.map(x=>'<li><b>'+esc(x.title||'Sin título')+'</b> · '+esc((x.authors||[]).join(', ')||'Autor sin identificar')+' · ISBN '+esc(x.isbn||'—')+'</li>').join('')+'</ul><p class="muted">El nuevo PDF quedó como borrador privado. Podés descartarlo o conservarlo como una edición/versión independiente.</p><div class="metadata-actions"><button class="secondary" id="bib-duplicate-skip" type="button">Descartar esta copia</button><button class="primary" id="bib-duplicate-keep" type="button">Conservar como libro diferente</button></div></section>';
    document.body.append(modal);
    const finish=value=>{modal.remove();resolve(value)};
    modal.querySelector('#bib-duplicate-close').onclick=()=>finish(false);
    modal.querySelector('#bib-duplicate-skip').onclick=()=>finish(false);
    modal.querySelector('#bib-duplicate-keep').onclick=()=>finish(true);
    modal.onclick=e=>{if(e.target===modal)finish(false)};
  });
}
async function discardUploadedDraft(id,token){
  const base=(c.pdfGatewayUrl||'').replace(/\/+$/,'');
  const response=await fetch(base+'/document/'+encodeURIComponent(id),{method:'DELETE',headers:{Authorization:'Bearer '+token}});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||'No se pudo descartar el duplicado.');
}
function normalizedBookText(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function bookDuplicateMatch(book,all){
  const isbn=String(book.isbn||'').replace(/[^0-9Xx]/g,'').toUpperCase();
  const title=normalizedBookText(book.title);
  const authors=(book.authors||[]).map(normalizedBookText).filter(Boolean);
  return all.find(other=>{
    if(other.id===book.id)return false;
    const otherIsbn=String(other.isbn||'').replace(/[^0-9Xx]/g,'').toUpperCase();
    if(isbn&&otherIsbn&&isbn===otherIsbn)return true;
    const otherTitle=normalizedBookText(other.title);
    if(!title||title.length<8||title!==otherTitle)return false;
    const otherAuthors=(other.authors||[]).map(normalizedBookText).filter(Boolean);
    return !authors.length||!otherAuthors.length||authors.some(a=>otherAuthors.includes(a));
  })||null;
}
function uploadStatusLabel(status){
  if(status==='uploading')return 'Carga en curso';
  if(status==='failed')return 'Carga incompleta';
  return 'PDF guardado';
}
function metadataStatusLabel(status){
  if(status==='processing')return 'Analizando';
  if(status==='complete')return 'Completo';
  if(status==='partial')return 'Parcial · revisar';
  if(status==='error')return 'Error · reintentar';
  return 'Pendiente';
}
async function loadLibraryFingerprintMap(){
  const map=new Map();let offset=0;
  while(true){
    const {data,error}=await db.from('documents')
      .select('id,title,authors,isbn,file_fingerprint')
      .not('file_fingerprint','is',null)
      .range(offset,offset+999);
    if(error)throw error;
    const rows=data||[];
    for(const row of rows){
      if(!row.file_fingerprint)continue;
      if(!map.has(row.file_fingerprint))map.set(row.file_fingerprint,[]);
      map.get(row.file_fingerprint).push(row);
    }
    if(rows.length<1000)break;
    offset+=1000;
  }
  return map;
}
function bookManagementRows(search='',status='all'){
  const all=[...books,...pendingDocs],q=normalizedBookText(search);
  const rows=all.filter(b=>{
    const published=books.some(x=>x.id===b.id);
    if(status==='published'&&!published)return false;
    if(status==='draft'&&published)return false;
    const hay=normalizedBookText([b.title,(b.authors||[]).join(' '),b.isbn,b.publisher,b.category,(b.tags||[]).join(' '),b.description].join(' '));
    return !q||hay.includes(q);
  });
  if(!rows.length)return '<tr><td colspan="8" class="empty-state">No hay libros que coincidan con este filtro.</td></tr>';
  return rows.map(b=>{
    const published=books.some(x=>x.id===b.id),collection=collections.find(x=>x.id===b.collectionId);
    const duplicate=bookDuplicateMatch(b,all);
    const loadLabel=uploadStatusLabel(b.uploadStatus);
    const metaLabel=metadataStatusLabel(b.metadataStatus);
    return '<tr data-book-id="'+esc(b.id)+'"><td><b>'+esc(b.title)+'</b><small>'+esc((b.authors||[]).join(', ')||'Autor sin identificar')+'</small>'+(duplicate?'<span class="duplicate-warning">Posible duplicado de: '+esc(duplicate.title)+'</span>':'')+'</td><td>'+esc(b.isbn||'—')+'</td><td>'+esc(collection?.name||'Sin colección')+'</td><td>'+(published?'<span class="pending-tag published-tag">Publicado</span>':'<span class="pending-tag">Borrador privado</span>')+'</td><td><span class="pending-tag">'+esc(loadLabel)+'</span></td><td><span class="pending-tag metadata-state">'+esc(metaLabel)+'</span>'+(b.metadataError?'<small>'+esc(b.metadataError)+'</small>':'')+'</td><td>'+esc(b.category||'General')+'</td><td><button class="small-action" data-edit-doc="'+esc(b.id)+'">Editar ficha</button>'+(b.uploadStatus==='stored'?'<button class="small-action" data-open="'+esc(b.id)+'">Vista previa</button>':'')+'<button class="small-action danger" data-delete-book="'+esc(b.id)+'">Eliminar</button></td></tr>';
  }).join('');
}
function booksPage(){
  const all=[...books,...pendingDocs];
  const pendingMetadata=all.filter(b=>b.provider==='r2'&&!b.metadataReviewed&&['pending','processing','partial','error'].includes(b.metadataStatus)).length;
  const unfinishedUploads=all.filter(b=>b.provider==='r2'&&b.uploadStatus!=='stored').length;
  const queueText=metadataInProgress?'Metadatos: '+metadataQueueProgress.done+'/'+metadataQueueProgress.total+' · errores: '+metadataQueueProgress.failed:(pendingMetadata?pendingMetadata+' ficha(s) pendientes de análisis':'No hay metadatos pendientes');
  return '<div class="heading"><div><h1>Administrar libros</h1><p>Los PDFs guardados se conservan aunque su ficha bibliográfica todavía no esté completa.</p></div><div class="books-admin-actions"><button class="secondary" id="reconcile-storage">Recuperar PDFs no registrados</button><button class="primary" id="run-metadata" '+(metadataInProgress||!pendingMetadata?'disabled':'')+'>Analizar metadatos pendientes ('+pendingMetadata+')</button></div></div><div class="metadata-queue-status" id="metadata-queue-status" aria-live="polite">'+esc(queueText)+'</div>'+(unfinishedUploads?'<p class="notice">Hay '+unfinishedUploads+' carga(s) incompleta(s). Podés revisar y eliminar los registros que no tengan PDF completo.</p>':'')+'<div class="catalog-controls books-admin-controls"><label>Buscar<input id="book-admin-search" type="search" placeholder="Título, autor, ISBN o tema"></label><label>Mostrar<select id="book-admin-status"><option value="all">Todos</option><option value="published">Publicados</option><option value="draft">Borradores privados</option></select></label></div><div class="panel"><table class="pending-table books-admin-table"><thead><tr><th>Libro / Autores</th><th>ISBN</th><th>Colección</th><th>Catálogo</th><th>Subida</th><th>Metadatos</th><th>Tipo</th><th>Acciones</th></tr></thead><tbody id="book-admin-rows">'+bookManagementRows()+'</tbody></table></div><p class="footnote">Las coincidencias bibliográficas se marcan como advertencia: confirmá que sean realmente el mismo libro antes de borrar o publicar.</p>';
}
function refreshMetadataQueueBanner(){
  const status=document.querySelector('#metadata-queue-status');
  if(status)status.textContent=metadataInProgress?'Metadatos: '+metadataQueueProgress.done+'/'+metadataQueueProgress.total+' · errores: '+metadataQueueProgress.failed:(metadataQueueProgress.total?'Análisis finalizado · '+metadataQueueProgress.done+'/'+metadataQueueProgress.total+' · errores: '+metadataQueueProgress.failed:'');
}
function bindBookManagement(){
  const search=document.querySelector('#book-admin-search'),status=document.querySelector('#book-admin-status'),body=document.querySelector('#book-admin-rows');
  const bindActions=()=>{
    body?.querySelectorAll('[data-edit-doc]').forEach(x=>x.onclick=()=>editDocumentMetadata(x.dataset.editDoc));
    body?.querySelectorAll('[data-delete-book]').forEach(x=>x.onclick=()=>deleteDocument(x.dataset.deleteBook));
    body?.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>openBook(x.dataset.open));
  };
  const refresh=()=>{if(body){body.innerHTML=bookManagementRows(search?.value||'',status?.value||'all');bindActions()}};
  search?.addEventListener('input',refresh);status?.addEventListener('change',refresh);
  document.querySelector('#run-metadata')?.addEventListener('click',()=>runMetadataQueue());
  document.querySelector('#reconcile-storage')?.addEventListener('click',async()=>{
    const button=document.querySelector('#reconcile-storage');if(button)button.disabled=true;
    try{
      const result=await reconcileStorageFromWorker();
      toast('Reconciliación finalizada: '+(result.recovered||0)+' PDF(s) recuperado(s), '+(result.completed||0)+' carga(s) verificadas.');
      await loadUser(me);
    }catch(error){toast('No se pudo reconciliar R2: '+error.message);if(button)button.disabled=false}
  });
  bindActions();
}
async function reconcileStorageFromWorker(tokenOverride=null){
  const {data:{session}}=await db.auth.getSession(),token=tokenOverride||session?.access_token;
  if(!token)throw new Error('Sesión vencida.');
  const base=(c.pdfGatewayUrl||'').replace(/\/+$/,'');
  const response=await fetch(base+'/admin/reconcile-storage',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||data.message||'La pasarela no pudo recuperar los archivos.');
  return data;
}
async function runMetadataQueue(ids=null,tokenOverride=null){
  if(metadataInProgress)return;
  const {data:{session}}=await db.auth.getSession(),token=tokenOverride||session?.access_token;
  if(!token)return toast('Tu sesión expiró. Inicia sesión nuevamente.');
  let request=db.from('documents').select('id,title')
    .eq('provider','r2').eq('metadata_reviewed',false)
    .eq('upload_status','stored').in('metadata_status',['pending','processing','partial','error'])
    .order('created_at',{ascending:true}).limit(500);
  if(Array.isArray(ids)&&ids.length)request=request.in('id',ids);
  const {data:documents,error}=await request;
  if(error)return toast('No se pudo cargar la cola de metadatos: '+error.message);
  const queue=documents||[];
  if(!queue.length){toast('No hay metadatos pendientes para analizar.');return}
  metadataInProgress=true;metadataQueueProgress={done:0,total:queue.length,failed:0};
  refreshMetadataQueueBanner();
  const rowStatus=(id,message)=>{
    const rows=document.querySelectorAll('[data-book-id="'+id+'"] .metadata-state');
    rows.forEach(x=>x.textContent=message);
  };
  let cursor=0;
  const worker=async()=>{
    while(true){
      const index=cursor++;if(index>=queue.length)return;
      const doc=queue[index];
      try{
        const {error:markError}=await db.from('documents').update({metadata_status:'processing',metadata_error:null}).eq('id',doc.id);
        if(markError)throw markError;
        rowStatus(doc.id,'Analizando');
        await analyzeStoredDocument(doc.id,false,token);
      }catch(error){
        const message=String(error?.message||'Error de análisis').slice(0,500);
        await db.from('documents').update({metadata_status:'error',metadata_error:message}).eq('id',doc.id);
        metadataQueueProgress.failed++;
        rowStatus(doc.id,'Error · reintentar');
      }finally{
        metadataQueueProgress.done++;
        refreshMetadataQueueBanner();
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));
  metadataInProgress=false;
  refreshMetadataQueueBanner();
  toast('Análisis de metadatos terminado: '+metadataQueueProgress.done+' PDF(s), '+metadataQueueProgress.failed+' error(es).');
  if(me&&page==='books')await loadUser(me);
}
async function uploadMultiple(e){
  e.preventDefault();
  if(role!=='admin'||!live)return toast('Solo el administrador puede cargar documentos.');
  const files=[...selectedFiles];
  if(!files.length)return toast('Seleccioná al menos un PDF.');
  const invalid=files.find(f=>!/\.pdf$/i.test(f.name)||(f.type&&f.type!=='application/pdf')||f.size<100||f.size>2*1024*1024*1024);
  if(invalid)return toast('Revisá "'+invalid.name+'": debe ser un PDF válido de hasta 2 GiB.');
  const {data:{session}}=await db.auth.getSession();
  if(!session?.access_token)return login('Tu sesión expiró. Inicia sesión nuevamente.');
  if(!c.pdfGatewayUrl)return toast('Falta configurar el gateway PDF.');
  const form=e.currentTarget,results=form.querySelector('#upload-results');
  uploadInProgress=true;renderUploadSelection();
  results.innerHTML=files.map((f,i)=>'<div class="upload-result" data-upload-row="'+i+'"><div><strong>'+esc(f.name)+'</strong><span class="upload-result-status">En cola</span></div><progress max="100" value="0"></progress></div>').join('');
  let libraryFingerprints=new Map(),fingerprintCheckAvailable=true;
  try{await ensureLibraryFingerprintIndex(session.access_token,()=>{});libraryFingerprints=await loadLibraryFingerprintMap()}
  catch(error){fingerprintCheckAvailable=false;console.warn('Exact duplicate check skipped; uploads continue:',error);toast('No se pudo completar la verificación previa de duplicados. La subida continuará igualmente.');}
  const batchFingerprints=new Map();let promptChain=Promise.resolve(),cursor=0,success=0,failed=0,skipped=0;
  const uploaded=[];
  const processFile=async()=>{
    while(true){
      const i=cursor++;if(i>=files.length)return;
      const file=files[i],row=results.querySelector('[data-upload-row="'+i+'"]'),status=row.querySelector('.upload-result-status'),progress=row.querySelector('progress');
      try{
        let fileFingerprint=null;
        status.textContent='Archivo '+(i+1)+'/'+files.length+' · Calculando huella…';
        try{
          fileFingerprint=await fingerprintFile(file,p=>{progress.value=p;status.textContent='Archivo '+(i+1)+'/'+files.length+' · Verificando duplicados · '+p+'%'});
        }catch(hashError){console.warn('Fingerprint calculation failed; file will still be uploaded:',hashError);status.textContent='Huella no disponible · se subirá sin verificación exacta';}
        if(fileFingerprint){
          const matches=[...(fingerprintCheckAvailable?(libraryFingerprints.get(fileFingerprint)||[]):[]),...(batchFingerprints.get(fileFingerprint)||[])];
          if(!batchFingerprints.has(fileFingerprint))batchFingerprints.set(fileFingerprint,[]);
          batchFingerprints.get(fileFingerprint).push({title:file.name,authors:[]});
          if(matches.length){
            status.textContent='PDF posiblemente duplicado · esperando decisión';
            const decision=promptChain.then(()=>askDuplicateChoice(file,matches));
            promptChain=decision.catch(()=>false);
            const shouldUpload=await decision;
            if(!shouldUpload){status.textContent='Duplicado omitido';row.classList.add('upload-result-skipped');skipped++;continue;}
          }
        }
        status.textContent='Archivo '+(i+1)+'/'+files.length+' · Subiendo…';progress.value=0;
        const saved=await uploadOneFile(file,session.access_token,p=>{progress.value=p;status.textContent='Archivo '+(i+1)+'/'+files.length+' · Subiendo · '+p+'%'},fileFingerprint);
        if(!saved?.id)throw new Error('El Worker no confirmó el identificador del documento guardado.');
        uploaded.push({id:saved.id});
        progress.value=100;status.textContent=saved.catalogueSynced?'PDF guardado en la biblioteca · metadatos pendientes':'PDF guardado · sincronización de catálogo pendiente';
        row.classList.add('upload-result-success');success++;
      }catch(error){
        status.textContent='Error de subida · '+(error?.message||'No se pudo guardar');
        row.classList.add('upload-result-error');failed++;
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(3,files.length)},processFile));
  selectedFiles=[];form.reset();uploadInProgress=false;renderUploadSelection();
  page='books';query='';
  let recovered={recovered:0,completed:0};
  try{recovered=await reconcileStorageFromWorker(session.access_token)}catch(error){console.warn('Post-upload R2 reconciliation unavailable:',error);}
  await loadUser(me);
  toast(success+' PDF(s) guardados'+(skipped?' · '+skipped+' duplicado(s) omitido(s)':'')+(failed?' · '+failed+' error(es)':'')+(recovered.recovered?' · '+recovered.recovered+' PDF(s) recuperados de R2':'')+'.');
  if(success||recovered.recovered)void runMetadataQueue(uploaded.map(x=>x.id),session.access_token);
}
function pendingPage(){
  return '<div class="heading"><div><h1>Metadatos pendientes</h1><p>Los documentos de esta lista están guardados en privado y todavía no aparecen para los lectores.</p></div><span class="tag">'+pendingDocs.length+' pendientes</span></div><div class="notice metadata-help"><b>La ficha se analiza automáticamente</b><span>Se leen las propiedades internas del PDF y el texto de las primeras cinco páginas para proponer título, autores, año, ISBN, editorial, temas y cantidad de páginas. Son sugerencias: revisalas antes de publicar. Los PDFs escaneados sin capa de texto pueden necesitar OCR adicional.</span></div>'+(pendingDocs.length?'<div class="panel"><table class="pending-table"><tr><th>Documento (nombre provisional)</th><th>Tamaño</th><th>Estado</th><th></th></tr>'+pendingDocs.map(d=>'<tr><td>'+esc(d.title)+'</td><td>'+esc(d.size)+'</td><td><span class="pending-tag">Privado</span></td><td><button class="small-action" data-analyze-doc="'+esc(d.id)+'">Analizar PDF</button><button class="small-action" data-edit-doc="'+esc(d.id)+'">Editar ficha</button><button class="small-action" data-open="'+esc(d.id)+'">Vista previa</button><button class="small-action danger" data-delete-book="'+esc(d.id)+'">Eliminar</button></td></tr>').join('')+'</table>':'<div class="panel empty-state">No hay fichas pendientes. Cuando subas PDFs, aparecerán aquí.')+'</div>';
}
function editDocumentMetadata(id){
 const d=books.find(x=>x.id===id)||pendingDocs.find(x=>x.id===id);if(!d)return;
 const published=books.some(x=>x.id===id),m=document.createElement('div');m.className='modal-bg';
 m.innerHTML='<section class="modal metadata-modal"><header><b>Ficha bibliográfica</b><button id="close" type="button">Cerrar ×</button></header><form id="metadata-form"><label>Título<input name="title" maxlength="300" required value="'+esc(d.title)+'"></label><label>Autor/es<input name="authors" maxlength="1000" value="'+esc(d.authors.join(', '))+'" placeholder="Separar varios autores con coma"></label><div class="upload-grid"><label>Categoría<input name="category" maxlength="100" value="'+esc(d.category)+'" required></label><label>Año de publicación<input name="publicationYear" type="number" min="1000" max="2100" value="'+esc(d.year)+'" placeholder="Opcional"></label><label>Colección<select name="collectionId"><option value="">Sin colección</option>'+collections.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===d.collectionId?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></label><label>Cantidad de páginas<input name="pageCount" type="number" min="1" max="100000" value="'+esc(d.pageCount||'')+'" placeholder="Opcional"></label><label>ISBN<input name="isbn" maxlength="32" value="'+esc(d.isbn||'')+'"></label><label>Editorial<input name="publisher" maxlength="200" value="'+esc(d.publisher||'')+'"></label></div><label>Temas / etiquetas<input name="tags" maxlength="1000" value="'+esc((d.tags||[]).join(', '))+'" placeholder="guitarra, armonía, piano…"></label><label>Descripción<textarea name="description" rows="4" maxlength="3000">'+esc(d.description)+'</textarea></label><p class="muted">Origen de metadatos: '+esc(d.metadataSource||'filename')+(d.metadataReviewed?' · revisados':' · pendientes de revisión')+'</p><div class="metadata-actions"><button class="secondary" id="save-private" type="button">'+(published?'Guardar cambios':'Guardar sin publicar')+'</button><button class="primary" id="publish-toggle" type="button">'+(published?'Guardar y retirar del catálogo':'Guardar y publicar')+'</button></div></form></section>';
 document.body.append(m);m.querySelector('#close').onclick=()=>m.remove();m.onclick=e=>{if(e.target===m)m.remove()};
 const save=async publish=>{const data=new FormData(m.querySelector('#metadata-form')),title=String(data.get('title')||'').trim(),year=String(data.get('publicationYear')||''),pages=String(data.get('pageCount')||'');const values={title,authors:String(data.get('authors')||'').split(',').map(x=>x.trim()).filter(Boolean),publication_year:year?Number(year):null,category:String(data.get('category')||'General').trim()||'General',description:String(data.get('description')||'').trim(),collection_id:String(data.get('collectionId')||'')||null,page_count:pages?Number(pages):null,isbn:String(data.get('isbn')||'').trim()||null,publisher:String(data.get('publisher')||'').trim()||null,tags:String(data.get('tags')||'').split(',').map(x=>x.trim()).filter(Boolean),metadata_source:'manual',metadata_reviewed:true,is_published:publish};if(!title)return toast('El título es obligatorio.');if(values.publication_year!==null&&(!Number.isInteger(values.publication_year)||values.publication_year<1000||values.publication_year>2100))return toast('Revisá el año.');if(values.page_count!==null&&(!Number.isInteger(values.page_count)||values.page_count<1||values.page_count>100000))return toast('Revisá las páginas.');const {error}=await db.from('documents').update(values).eq('id',id);if(error)return toast('No se pudo guardar: '+error.message);m.remove();toast(publish?'Ficha publicada.':published?'Cambios guardados y retirado del catálogo.':'Ficha guardada como borrador.');await loadUser(me)};
 m.querySelector('#save-private').onclick=()=>save(published);m.querySelector('#publish-toggle').onclick=()=>save(!published);
}
function usersPage(){return '<div class="heading"><div><h1>Usuarios</h1><p>Creá cuentas y administrá permisos de acceso.</p></div><button class="primary" id="add">+ Crear usuario</button></div><div class="panel"><table class="user-table"><tr><th>Usuario</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr>'+users.map(u=>'<tr><td><b>'+esc(u.name||'Sin nombre')+'</b><small>@'+esc(u.username||'sin username')+'</small></td><td>'+esc(u.email)+'</td><td>'+label(u.role)+'</td><td>'+(u.status==='active'?'Activo':'Suspendido')+'</td><td><button class="small-action" data-edit-user="'+esc(u.id)+'">Editar</button>'+(u.id!==me.id?'<button class="small-action danger" data-delete-user="'+esc(u.id)+'">Eliminar</button>':'<span class="muted">Tu cuenta</span>')+'</td></tr>').join('')+'</table></div>'}
function accountPage(){return '<div class="heading"><div><h1>Mi cuenta</h1><p>Administrá tus datos y métodos de acceso.</p></div></div><div class="panel account-panel"><form id="account-form"><label>Nombre visible<input name="fullName" maxlength="120" value="'+esc(me.name)+'" required></label><label>Nombre de usuario<input name="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]{3,32}" value="'+esc(me.username||'')+'" placeholder="ej. usuario.biblioteca"><small>3–32 caracteres: letras, números, punto, guion o guion bajo.</small></label><label>Correo electrónico<input name="email" type="email" value="'+esc(me.email)+'" required></label><div class="account-divider"></div><h3>Cambiar contraseña</h3><p class="muted">Dejá estos campos vacíos si no querés modificarla.</p><label>Nueva contraseña<input name="password" type="password" minlength="8" autocomplete="new-password"></label><label>Repetir nueva contraseña<input name="password2" type="password" minlength="8" autocomplete="new-password"></label><button class="primary">Guardar cambios</button></form></div>'}
async function saveAccount(e){e.preventDefault();const f=new FormData(e.currentTarget),fullName=String(f.get('fullName')||'').trim(),username=String(f.get('username')||'').trim().toLowerCase(),email=String(f.get('email')||'').trim().toLowerCase(),password=String(f.get('password')||''),password2=String(f.get('password2')||''),emailChanged=email!==me.email;if(!fullName)return toast('Ingresá tu nombre.');if(username&&!/^[a-z0-9._-]{3,32}$/.test(username))return toast('El username debe tener 3–32 caracteres válidos.');if(password&&password.length<8)return toast('La contraseña debe tener al menos 8 caracteres.');if(password!==password2)return toast('Las contraseñas no coinciden.');const {error:profileError}=await db.from('profiles').update({full_name:fullName,username:username||null}).eq('id',me.id);if(profileError)return toast('No se pudo guardar el perfil: '+profileError.message);const authUpdates={data:{full_name:fullName}};if(emailChanged)authUpdates.email=email;if(password)authUpdates.password=password;const {data,error}=await db.auth.updateUser(authUpdates);if(error)return toast('El perfil se guardó, pero falló la actualización de credenciales: '+error.message);me.name=fullName;me.username=username;me.email=data.user?.email||me.email;toast(emailChanged?'Perfil actualizado. Revisá tu correo para confirmar la nueva dirección.':'Datos de cuenta actualizados.');await loadUser(data.user||me)}
function catalogControls(){return '<div class="catalog-controls"><label>Ordenar<select id="sort-by"><option value="title" '+(sortBy==='title'?'selected':'')+'>Título</option><option value="year" '+(sortBy==='year'?'selected':'')+'>Antigüedad · año</option><option value="pages" '+(sortBy==='pages'?'selected':'')+'>Extensión · páginas</option></select></label><button id="sort-dir" class="secondary">'+(sortDir==='asc'?'Ascendente ↑':'Descendente ↓')+'</button><label>Presentación<select id="view-mode"><option value="grid" '+(viewMode==='grid'?'selected':'')+'>Cuadrícula</option><option value="list" '+(viewMode==='list'?'selected':'')+'>Lista</option></select></label><label>Densidad<select id="density"><option value="2" '+(density===2?'selected':'')+'>Cómoda · 2 columnas</option><option value="3" '+(density===3?'selected':'')+'>Normal · 3 columnas</option><option value="4" '+(density===4?'selected':'')+'>Compacta · 4 columnas</option><option value="5" '+(density===5?'selected':'')+'>Muy compacta · 5 columnas</option></select></label><label>Colección<select id="filter-collection"><option value="">Todas</option>'+collections.map(x=>'<option value="'+esc(x.id)+'" '+(filterCollection===x.id?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></label><label>Tema<select id="filter-category"><option value="">Todos los temas</option>'+[...new Set([...books.map(x=>x.category).filter(Boolean),...books.flatMap(x=>x.tags||[])])].sort().map(x=>'<option value="'+esc(x)+'" '+(filterCategory===x?'selected':'')+'>'+esc(x)+'</option>').join('')+'</select></label></div>'}
function collectionShelves(){const shelves=collections.map(c=>({id:c.id,name:c.name,description:c.description||'',docs:books.filter(b=>b.collectionId===c.id)}));const loose=books.filter(b=>!b.collectionId);if(loose.length)shelves.push({id:'',name:'Sin colección',description:'Documentos todavía no asignados',docs:loose});return shelves.filter(c=>c.docs.length).map(c=>'<section class="shelf"><div class="shelf-heading"><div><h2>'+esc(c.name)+'</h2><p>'+c.docs.length+' documentos · '+esc(c.description)+'</p></div>'+(c.id?'<button data-collection="'+esc(c.id)+'">Ver todos →</button>':'')+'</div><div class="shelf-row">'+c.docs.slice(0,10).map(card).join('')+'</div></section>').join('')||'<div class="empty-state">Todavía no hay colecciones con libros publicados.</div>'}
function collectionsPage(){return '<div class="heading"><div><h1>Colecciones</h1><p>Organizá los libros en estantes temáticos.</p></div>'+(role==='admin'?'<button class="primary collection-add" id="add-collection">+ Nueva colección</button>':'')+'</div><div class="collection-grid">'+collections.map(c=>{const count=books.filter(b=>b.collectionId===c.id).length;return '<div class="collection-tile"><button class="collection-open" data-collection="'+esc(c.id)+'"><b>'+esc(c.name)+'</b><small>'+count+' documentos</small><p>'+esc(c.description||'')+'</p></button>'+(role==='admin'?'<div class="collection-actions"><button class="small-action" data-edit-collection="'+esc(c.id)+'">Editar</button><button class="small-action danger" data-delete-collection="'+esc(c.id)+'">Eliminar</button></div>':'')+'</div>'}).join('')+'</div><section class="shelf"><div class="shelf-heading"><h2>Sin colección</h2><small>'+books.filter(b=>!b.collectionId).length+' documentos</small></div><div class="shelf-row">'+books.filter(b=>!b.collectionId).slice(0,10).map(card).join('')+'</div></section>'}
function collectionModal(existing=null){const m=document.createElement('div');m.className='modal-bg';m.innerHTML='<section class="modal user-modal"><header><b>'+(existing?'Editar colección':'Nueva colección')+'</b><button id="close" type="button">Cerrar</button></header><form id="collection-form"><label>Nombre<input name="name" maxlength="100" required value="'+esc(existing?.name||'')+'"></label><label>Descripción<textarea name="description" rows="3" maxlength="500">'+esc(existing?.description||'')+'</textarea></label><button class="primary">'+(existing?'Guardar cambios':'Crear colección')+'</button></form></section>';document.body.append(m);m.querySelector('#close').onclick=()=>m.remove();m.querySelector('#collection-form').onsubmit=async e=>{e.preventDefault();const data=new FormData(e.currentTarget),name=String(data.get('name')||'').trim(),description=String(data.get('description')||'').trim();if(!name)return toast('Ingresá un nombre.');const slug=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-'+(existing?.id||crypto.randomUUID()).slice(0,8);const result=existing?await db.from('collections').update({name,description,slug}).eq('id',existing.id):await db.from('collections').insert({name,description,slug});if(result.error)return toast('No se pudo guardar: '+result.error.message);m.remove();toast(existing?'Colección actualizada.':'Colección creada.');await loadUser(me)}}
function addCollection(){if(role==='admin')collectionModal()}
function editCollection(id){const c=collections.find(x=>x.id===id);if(c&&role==='admin')collectionModal(c)}
async function deleteCollection(id){const c=collections.find(x=>x.id===id);if(!c||role!=='admin')return;const count=books.filter(b=>b.collectionId===id).length+pendingDocs.filter(b=>b.collectionId===id).length;if(!confirm('¿Eliminar la colección "'+c.name+'"'+(count?' y quitarla de '+count+' fichas':'')+'? Los libros y sus PDFs no se borrarán.'))return;const {error:moveError}=await db.from('documents').update({collection_id:null}).eq('collection_id',id);if(moveError)return toast('No se pudieron liberar los libros: '+moveError.message);const {error}=await db.from('collections').delete().eq('id',id);if(error)return toast('No se pudo eliminar: '+error.message);toast('Colección eliminada; los libros se conservaron.');await loadUser(me)}
function content(){if(page==='account')return accountPage();if(page==='upload'&&role==='admin')return uploadPage();if((page==='books'||page==='pending')&&role==='admin')return booksPage();if(page==='users'&&role==='admin')return usersPage();if(page==='settings'&&role==='admin')return '<div class="heading"><h1>Configuración</h1></div><div class="panel"><h2>Almacenamiento privado</h2><p>Bucket R2 privado conectado. Los PDFs se entregan por pasarela autenticada.</p><h2>Metadatos</h2><p>Los nuevos PDFs se analizan al subirlos; las sugerencias deben revisarse antes de publicar.</p></div>';if(page==='collections')return collectionsPage();let list=filtered(),title=page==='favorites'?'Mis favoritos':page==='catalog'?'Todos los libros':'Tu biblioteca',controls=page==='catalog'||page==='favorites'?catalogControls():'';return '<div class="heading"><div><h1>'+title+'</h1><p>Hola, '+esc(me.name)+'. Tu biblioteca organizada en un solo lugar.</p></div><span class="tag">'+list.length+' libros</span></div>'+(page==='home'?'<div class="stats"><div>Documentos<b>'+books.length+'</b></div><div>Colecciones<b>'+collections.length+'</b></div><div>Favoritos<b>'+favs.size+'</b></div><div>Lecturas<b>'+history.length+'</b></div></div><h2 class="section-heading">Tus colecciones</h2>'+collectionShelves():'')+controls+(page==='catalog'||page==='favorites'?'<div class="chips">'+[...new Set(books.map(x=>x.category).filter(Boolean))].sort().map(x=>'<button data-cat="'+esc(x)+'">'+esc(x)+'</button>').join('')+'<button data-clear-filters="1">Limpiar filtros</button></div>':'')+'<div class="'+(viewMode==='list'?'book-list':'grid')+'" style="--book-columns:'+density+'">'+list.map(card).join('')+'</div><p class="footnote">'+(live?'Acceso a documentos autorizados por tu cuenta.':'PDF ficticios de demostración.')+'</p>'}
function render(){window.__BIBLIOTECA_READY__=true;root.innerHTML=(live?'':'<div class="demo-strip">MODO DEMOSTRACIÓN · sin autenticación real</div>')+'<aside class="sidebar"><div class="brand"><b>B</b> MI BIBLIOTECA</div><small>BIBLIOTECA</small>'+nav('home','⌂ Inicio')+nav('catalog','▤ Todos los libros')+nav('favorites','♡ Favoritos')+nav('collections','▦ Colecciones')+nav('account','♙ Mi cuenta')+(role==='admin'?'<small>ADMINISTRACIÓN</small>'+nav('users','♟ Usuarios')+nav('books','▤ Administrar libros')+nav('upload','＋ Subir PDFs')+nav('settings','⚙ Configuración'):'')+'<div class="side-bottom"><b>'+esc(me.name)+'</b><small>'+label(role)+'</small><button id="logout">Cerrar sesión</button></div></aside><main class="main"><header><span>Mi Biblioteca / '+esc(page)+'</span><input id="search" placeholder="Buscar título, autor o tema..." value="'+esc(query)+'"><b>'+esc(me.name)+'</b></header><section class="page">'+content()+'</section></main>';document.querySelectorAll('[data-page]').forEach(x=>x.onclick=()=>{page=x.dataset.page;render()});document.querySelector('#logout').onclick=signOut;document.querySelector('#search').oninput=e=>{query=e.target.value;const g=document.querySelector('.grid,.book-list');if(g)g.innerHTML=filtered().map(card).join('');bindBooks();if(page==='books'||page==='pending')bindBookManagement()};document.querySelectorAll('[data-cat]').forEach(x=>x.onclick=()=>{page='catalog';filterCategory=x.dataset.cat;filterCollection='';render()});document.querySelector('#add')?.addEventListener('click',addUser);document.querySelector('#account-form')?.addEventListener('submit',saveAccount);document.querySelector('#sort-by')?.addEventListener('change',e=>{sortBy=e.target.value;render()});document.querySelector('#sort-dir')?.addEventListener('click',()=>{sortDir=sortDir==='asc'?'desc':'asc';render()});document.querySelector('#view-mode')?.addEventListener('change',e=>{viewMode=e.target.value;render()});document.querySelector('#density')?.addEventListener('change',e=>{density=Number(e.target.value);render()});document.querySelector('#filter-collection')?.addEventListener('change',e=>{filterCollection=e.target.value;render()});document.querySelector('#filter-category')?.addEventListener('change',e=>{filterCategory=e.target.value;render()});document.querySelectorAll('[data-collection]').forEach(x=>x.onclick=()=>{page='catalog';filterCollection=x.dataset.collection;render()});document.querySelector('#add-collection')?.addEventListener('click',addCollection);document.querySelectorAll('[data-edit-collection]').forEach(x=>x.onclick=()=>editCollection(x.dataset.editCollection));document.querySelectorAll('[data-delete-collection]').forEach(x=>x.onclick=()=>deleteCollection(x.dataset.deleteCollection));document.querySelector('[data-clear-filters]')?.addEventListener('click',()=>{filterCollection='';filterCategory='';query='';render()});document.querySelector('#upload-form')?.addEventListener('submit',uploadMultiple);document.querySelector('#upload-files')?.addEventListener('change',e=>{if(uploadInProgress)return;selectedFiles=Array.from(e.target.files||[]);renderUploadSelection()});const drop=document.querySelector('#upload-drop');drop?.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging')});drop?.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop?.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');if(uploadInProgress)return;selectedFiles=Array.from(e.dataTransfer?.files||[]);renderUploadSelection()});document.querySelectorAll('[data-edit-doc]').forEach(x=>x.onclick=()=>editDocumentMetadata(x.dataset.editDoc));document.querySelectorAll('[data-edit-book]').forEach(x=>x.onclick=()=>editDocumentMetadata(x.dataset.editBook));document.querySelectorAll('[data-delete-book]').forEach(x=>x.onclick=()=>deleteDocument(x.dataset.deleteBook));document.querySelectorAll('[data-analyze-doc]').forEach(x=>x.onclick=async()=>{try{await analyzeStoredDocument(x.dataset.analyzeDoc,true);await loadUser(me)}catch(e){toast('No se pudo analizar: '+e.message)}});document.querySelectorAll('[data-edit-user]').forEach(x=>x.onclick=()=>editUser(x.dataset.editUser));document.querySelectorAll('[data-delete-user]').forEach(x=>x.onclick=()=>deleteUser(x.dataset.deleteUser));bindBooks();if(page==='books'||page==='pending')bindBookManagement()}
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

async function adminUsersAction(body){const {data,error}=await db.functions.invoke('admin-users',{body});if(error)throw new Error(error.message||'Error de administración');if(data?.error)throw new Error(data.error);return data}
function addUser(){const m=document.createElement('div');m.className='modal-bg';m.innerHTML='<section class="modal user-modal"><header><b>Crear usuario</b><button id="close" type="button">Cerrar</button></header><form id="new"><label>Nombre visible<input name="fullName" required maxlength="120"></label><label>Username opcional<input name="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]{3,32}"></label><label>Correo electrónico<input name="email" type="email" required></label><label>Contraseña temporal<input name="password" type="password" minlength="8" required></label><label>Rol<select name="role"><option value="reader">Lector</option><option value="editor">Editor</option><option value="admin">Administrador</option></select></label><button class="primary">Crear usuario</button></form></section>';document.body.append(m);m.querySelector('#close').onclick=()=>m.remove();m.querySelector('#new').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));try{await adminUsersAction({action:'create',...body});toast('Usuario creado.');m.remove();await loadUser(me)}catch(error){toast('No se pudo crear: '+error.message)}}}
function editUser(id){const u=users.find(x=>x.id===id);if(!u)return;const m=document.createElement('div');m.className='modal-bg';m.innerHTML='<section class="modal user-modal"><header><b>Editar usuario</b><button id="close" type="button">Cerrar</button></header><form id="edit"><label>Nombre visible<input name="fullName" maxlength="120" value="'+esc(u.name)+'" required></label><label>Username<input name="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]{3,32}" value="'+esc(u.username||'')+'"></label><label>Rol<select name="role"><option value="reader" '+(u.role==='reader'?'selected':'')+'>Lector</option><option value="editor" '+(u.role==='editor'?'selected':'')+'>Editor</option><option value="admin" '+(u.role==='admin'?'selected':'')+'>Administrador</option></select></label><label>Estado<select name="status"><option value="active" '+(u.status==='active'?'selected':'')+'>Activo</option><option value="suspended" '+(u.status==='suspended'?'selected':'')+'>Suspendido</option></select></label><p class="muted">Correo: '+esc(u.email)+' · el usuario puede cambiarlo desde Mi cuenta.</p><button class="primary">Guardar cambios</button></form></section>';document.body.append(m);m.querySelector('#close').onclick=()=>m.remove();m.querySelector('#edit').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));try{await adminUsersAction({action:'update',userId:id,...body});toast('Usuario actualizado.');m.remove();await loadUser(me)}catch(error){toast('No se pudo actualizar: '+error.message)}}}
async function deleteUser(id){const u=users.find(x=>x.id===id);if(!u||id===me.id)return;if(!confirm('¿Eliminar la cuenta de '+(u.name||u.email)+'? Esta acción no se puede deshacer.'))return;try{await adminUsersAction({action:'delete',userId:id});toast('Usuario eliminado.');await loadUser(me)}catch(error){toast('No se pudo eliminar: '+error.message)}}
async function deleteDocument(id){const d=books.find(x=>x.id===id)||pendingDocs.find(x=>x.id===id);if(!d||role!=='admin')return;if(!confirm('¿Eliminar definitivamente "'+d.title+'" y su PDF privado? Esta acción no se puede deshacer.'))return;const {data:{session}}=await db.auth.getSession();if(!session?.access_token)return login('Tu sesión expiró.');const base=(c.pdfGatewayUrl||'').replace(/\/+$/,'');try{const response=await fetch(base+'/document/'+encodeURIComponent(id),{method:'DELETE',headers:{Authorization:'Bearer '+session.access_token}});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'No se pudo eliminar.');toast(result.storageCleanupPending?'Registro eliminado; el almacenamiento requiere limpieza manual.':'Documento y archivo eliminados.');await loadUser(me)}catch(error){toast('Error al eliminar: '+error.message)}}
async function lookupIsbnMetadata(isbn){
  const clean=String(isbn||'').replace(/[^0-9Xx]/g,'').toUpperCase();
  if(![10,13].includes(clean.length))return null;
  const timeout=()=>AbortSignal.timeout(8000);
  try{
    const url='https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent('isbn:'+clean)+'&maxResults=5';
    const response=await fetch(url,{signal:timeout()});
    if(response.ok){
      const data=await response.json();
      const candidates=(data.items||[]).map(x=>x.volumeInfo||{}).filter(v=>{
        const ids=(v.industryIdentifiers||[]).map(x=>String(x.identifier||'').replace(/[^0-9Xx]/g,'').toUpperCase());
        return !ids.length||ids.includes(clean);
      });
      const v=candidates[0];
      if(v){
        const date=String(v.publishedDate||'').match(/(?:19|20)\d{2}/);
        const categories=(v.categories||[]).flatMap(x=>String(x).split(/[\/;|]/)).map(x=>x.trim()).filter(Boolean);
        const description=String(v.description||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim().slice(0,3000);
        return {title:v.title||'',authors:v.authors||[],publisher:v.publisher||'',year:date?Number(date[0]):null,description,tags:categories,pageCount:v.pageCount||null,source:'Google Books'};
      }
    }
  }catch(error){console.info('Google Books ISBN lookup unavailable:',error?.message||error)}
  try{
    const response=await fetch('https://openlibrary.org/isbn/'+encodeURIComponent(clean)+'.json',{signal:timeout()});
    if(response.ok){
      const v=await response.json();
      const authors=[];
      for(const item of (v.authors||[]).slice(0,5)){
        if(item?.name){authors.push(String(item.name));continue}
        const key=item?.key;
        if(!key)continue;
        try{const ar=await fetch('https://openlibrary.org'+key+'.json',{signal:timeout()});if(ar.ok){const a=await ar.json();if(a.name)authors.push(a.name)}}catch{}
      }
      const subjects=(v.subjects||[]).map(x=>typeof x==='string'?x:(x?.name||'')).filter(Boolean).slice(0,30);
      const date=String(v.publish_date||'').match(/(?:19|20)\d{2}/);
      return {title:v.title||'',authors,publisher:(v.publishers||[]).map(x=>typeof x==='string'?x:x?.name).filter(Boolean)[0]||'',year:date?Number(date[0]):null,description:typeof v.description==='string'?v.description:String(v.description?.value||''),tags:subjects,pageCount:v.number_of_pages||null,source:'Open Library'};
    }
  }catch(error){console.info('Open Library ISBN lookup unavailable:',error?.message||error)}
  return null;
}

async function analyzeStoredDocument(id,showToast=true,tokenOverride=null,additionalCandidates=[]){
  let d=books.find(x=>x.id===id)||pendingDocs.find(x=>x.id===id);
  if(!d){
    const {data:row,error}=await db.from('documents').select('id,title,authors,publication_year,category,page_count,size_bytes,provider,description,tags,isbn,publisher,metadata_source,metadata_reviewed,metadata_status,metadata_error,upload_status,original_filename').eq('id',id).single();
    if(error||!row)throw error||new Error('Documento no encontrado.');
    d={id:row.id,title:row.title,authors:row.authors||[],year:row.publication_year||'',category:row.category||'General',pageCount:row.page_count||0,provider:row.provider,description:row.description||'',tags:row.tags||[],isbn:row.isbn||'',publisher:row.publisher||'',metadataSource:row.metadata_source||'filename',metadataReviewed:!!row.metadata_reviewed,metadataStatus:row.metadata_status||'pending',metadataError:row.metadata_error||'',uploadStatus:row.upload_status||'stored'};
  }
  if(d.provider!=='r2')return {};
  if(d.uploadStatus&&d.uploadStatus!=='stored')throw new Error('El PDF todavía no está marcado como guardado en R2.');
  const {data:{session}}=await db.auth.getSession(),token=tokenOverride||session?.access_token;
  if(!token)throw new Error('Sesión vencida.');
  const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const url=(c.pdfGatewayUrl||'').replace(/\/+$/,'')+'/pdf/'+encodeURIComponent(id);
  const task=pdfjs.getDocument({url,httpHeaders:{Authorization:'Bearer '+token},withCredentials:false,disableAutoFetch:true,disableStream:true,rangeChunkSize:65536});
  try{
    const pdf=await task.promise,meta=await pdf.getMetadata(),info=meta?.info||{};
    let text='';
    for(let n=1;n<=Math.min(pdf.numPages,8);n++){
      const page=await pdf.getPage(n),tc=await page.getTextContent();
      text+=tc.items.map(x=>(x.str||'')+(x.hasEOL?'\n':' ')).join('');
    }
    const normalized=[text,info.Subject||'',info.Keywords||''].join('\n').replace(/[\t\u00a0]+/g,' ').replace(/ {2,}/g,' ').replace(/\r/g,'\n');
    const lines=normalized.split('\n').flatMap(line=>line.split(/ {3,}/)).map(x=>x.trim()).filter(x=>x.length>3);
    const candidates=lines.filter(x=>x.length>=6&&x.length<=140&&!/^(isbn|issn|copyright|derechos|www\.|https?:|editorial|ediciones|impreso|printed|autor(?:es)?|índice|indice|contenido|contents)/i.test(x));
    const infoTitle=String(info.Title||'').trim(),pdfTitle=infoTitle.length>=4&&infoTitle.length<=300?infoTitle:(candidates[0]||'');
    const infoAuthor=String(info.Author||'').trim(),authorMatch=normalized.match(/(?:autor(?:es)?|compositor(?:es)?|escrito por|by)\s*[:\-]\s*([^\n]{3,100})/i);
    const pdfAuthors=infoAuthor?infoAuthor.split(/[;,]/).map(x=>x.trim()).filter(Boolean):authorMatch?[authorMatch[1].trim()]:[];
    const isbnMatch=normalized.match(/ISBN(?:-1[03])?\s*[:\-]?\s*((?:97[89][\s-]?)?[0-9Xx][0-9Xx\s-]{8,20}[0-9Xx])/i);
    const isbn=isbnMatch?isbnMatch[1].replace(/[\s-]/g,'').toUpperCase():d.isbn||'';
    const yearMatch=normalized.match(/(?:©|copyright|derechos reservados|edici[oó]n|impreso|publicado|printed|publication)\D{0,45}((?:19|20)\d{2})/i),pdfYear=yearMatch?Number(yearMatch[1]):null;
    const pubMatch=normalized.match(/(?:editorial|ediciones|publisher|published by)\s*[:\-]?\s*([^\n]{3,90})/i),pdfPublisher=pubMatch?pubMatch[1].trim().slice(0,200):'';
    const embeddedTags=String(info.Keywords||'').split(/[,;|]/).map(x=>x.trim()).filter(x=>x.length>1&&x.length<50);
    const lower=normalized.toLowerCase(),taxonomy=[['guitarra',['guitarra','guitar','tablatura','fretboard']],['piano',['piano','teclado','keyboard']],['armonía',['armonía','armonia','harmony','acordes']],['teoría musical',['teoría musical','teoria musical','escalas','modos griegos','contrapunto']],['partituras',['partitura','score','pentagrama','notación musical','notacion musical']],['canto y voz',['canto','voz','vocal','coral','coro']],['jazz',['jazz','bebop','swing','blues']]];
    const pdfTags=taxonomy.filter(([_,terms])=>terms.some(term=>lower.includes(term))).map(([tag])=>tag);
    const external=isbn?await lookupIsbnMetadata(isbn):null;
    const isManual=d.metadataReviewed||d.metadataSource==='manual';
    const externalTitle=external?.title&&external.title.trim().length>2?external.title.trim():'';
    const resolvedTitle=externalTitle||pdfTitle;
    const resolvedAuthors=external?.authors?.length?external.authors:pdfAuthors;
    const resolvedYear=external?.year||pdfYear;
    const resolvedPublisher=external?.publisher||pdfPublisher;
    const externalTags=external?.tags||[];
    const allTags=[...new Set([...embeddedTags,...pdfTags,...externalTags].map(x=>String(x).trim()).filter(x=>x.length>1&&x.length<80))].slice(0,30);
    const combinedText=(allTags.join(' ')+' '+lower).toLowerCase();
    let inferredCategory=d.category;
    if(combinedText.includes('guitarra')||combinedText.includes('guitar'))inferredCategory='Partituras para guitarra';
    else if(combinedText.includes('piano'))inferredCategory='Música para piano';
    else if(combinedText.includes('jazz'))inferredCategory='Jazz';
    else if(combinedText.includes('music')||combinedText.includes('música')||combinedText.includes('musica'))inferredCategory='Música';
    else if(allTags.length)inferredCategory=allTags[0].slice(0,100);
    const updates={page_count:pdf.numPages,metadata_reviewed:false,metadata_error:null};
    if(!isManual){
      if((d.metadataSource==='filename'||!d.metadataSource||!d.title)&&resolvedTitle)updates.title=resolvedTitle.slice(0,300);
      if(!d.authors?.length&&resolvedAuthors.length)updates.authors=resolvedAuthors.slice(0,20);
      if(!d.year&&resolvedYear)updates.publication_year=resolvedYear;
      if(!d.isbn&&isbn&&[10,13].includes(isbn.length))updates.isbn=isbn;
      if(!d.publisher&&resolvedPublisher)updates.publisher=resolvedPublisher.slice(0,200);
      if((!d.category||d.category==='General')&&allTags.length)updates.category=inferredCategory;
      if(!d.tags?.length&&allTags.length)updates.tags=allTags;
      const externalDescription=String(external?.description||'').trim();
      if(!d.description&&(externalDescription||info.Subject))updates.description=(externalDescription||String(info.Subject||'')).slice(0,3000);
      updates.metadata_source=external?'pdf+isbn':(resolvedTitle||resolvedAuthors.length||isbn||resolvedYear||allTags.length?'pdf_text':'filename');
      updates.metadata_status=(resolvedTitle||resolvedAuthors.length||isbn||resolvedYear||resolvedPublisher||allTags.length||external?.description||info.Subject)?'complete':'partial';
    }else{
      updates.metadata_source='manual';
      updates.metadata_reviewed=true;
      updates.metadata_status='complete';
    }
    const {error}=await db.from('documents').update(updates).eq('id',id);
    if(error)throw error;
    const candidate={...d,...updates,title:updates.title||d.title,authors:updates.authors||d.authors,isbn:updates.isbn||d.isbn};
    const possibleDuplicates=[...books,...pendingDocs,...additionalCandidates].filter(other=>other&&bookDuplicateMatch(candidate,[other]));
    return {...updates,isbnLookup:!!external,metadataProvider:external?.source||null,possibleDuplicates,candidate};
  }finally{try{await task.destroy()}catch{}}
}

async function signOut(){if(live)await db.auth.signOut();me=null;books=[];pendingDocs=[];users=[];collections=[];selectedFiles=[];role='reader';page='home';query='';sortBy='title';sortDir='asc';viewMode='grid';density=3;filterCollection='';filterCategory='';favs.clear();history=[];bookAdminStatus='all';login()}
async function startLibrary(){
  try{
    const {data:{session},error}=await db.auth.getSession();
    if(error)throw error;
    if(session)await loadUser(session.user);else login();
    db.auth.onAuthStateChange((_event,nextSession)=>{
      if(!nextSession&&me)login();
    });
  }catch(error){
    console.error('Library startup failed:',error);
    login('No se pudo completar la carga de la biblioteca. Volvé a ingresar. Detalle: '+(error?.message||'error inesperado'));
  }
}
if(live)startLibrary();else login();
