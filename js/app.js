import{createClient}from'https://esm.sh/@supabase/supabase-js@2';
const c=window.BIBLIOTECA_CONFIG||{},live=!!(c.supabaseUrl&&c.supabaseAnonKey&&c.demoMode===false),db=live?createClient(c.supabaseUrl,c.supabaseAnonKey):null,root=document.querySelector('#app');
let me=null,role='reader',page='home',query='',books=[],pendingDocs=[],users=[],collections=[],selectedFiles=[],uploadInProgress=false,metadataInProgress=false,metadataCancelRequested=false,metadataQueueProgress={done:0,total:0,failed:0},favs=new Set(),history=[],sortBy='title',sortDir='asc',viewMode='grid',density=3,filterCollection='',filterCategory='',bookAdminStatus='all',selectedBookIds=new Set();
const sample=[['d1','Atlas del Archipielago Luminario','Elena Mar de Papel','Geografia imaginaria','atlas-luminario.pdf','sea'],['d2','Herbario de Arrecife Azul','Tomas del Invernadero','Naturaleza','herbario-arrecife-azul.pdf','leaf'],['d3','Cuaderno musical de Ciudad Resonante','Mara Afinacion','Musica','cuaderno-musica-ciudad.pdf','amber']].map(x=>({id:x[0],title:x[1],author:x[2],category:x[3],year:2026,pages:1,size:'PDF de muestra',provider:'demo',path:'/demo/pdfs/'+x[4],tone:x[5]}));
const demoUsers=[{name:'Administracion de prueba',email:'admin@biblioteca.local',role:'admin',status:'Activo'},{name:'Lector de ejemplo',email:'demo@biblioteca.local',role:'reader',status:'Activo'}];
const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),label=r=>r==='admin'?'Administrador':r==='editor'?'Editor':'Lector';
function toast(s){let n=document.createElement('div');n.className='toast';n.textContent=s;document.body.append(n);setTimeout(()=>n.remove(),2800)}
function login(msg=''){window.__BIBLIOTECA_READY__=true;root.innerHTML='<div class="demo-strip">'+(live?'ACCESO PRIVADO · SUPABASE':'MODO DEMOSTRACION · USUARIOS FICTICIOS')+'</div><main class="login"><section class="art" aria-hidden="true"><div class="brand"><b>B</b></div></section><section class="login-side"><form id="login"><div class="mark">B</div><h2>Bienvenido</h2><p>Ingresa para continuar a tu biblioteca.</p>'+(msg?'<div class="notice">'+esc(msg)+'</div>':'')+'<label>Correo o nombre de usuario<input name="email" type="text" autocomplete="username" required></label><label>Contrasena<input name="password" type="password" autocomplete="current-password" required></label><button class="primary">Ingresar →</button>'+(live?'':'<div class="demo-box"><b>CUENTAS FICTICIAS</b>Administrador: admin@biblioteca.local <code>admin1234</code>Lector: demo@biblioteca.local <code>demo1234</code><small>Solo para probar la interfaz. No son cuentas reales ni protegen datos privados.</small></div>')+'</form></section></main>';document.querySelector('#login').onsubmit=signIn}
async function signIn(e){e.preventDefault();let f=new FormData(e.currentTarget),email=String(f.get('email')).toLowerCase(),password=String(f.get('password'));if(!live){let a=email==='admin@biblioteca.local'&&password==='admin1234'?['Administracion de prueba','admin']:email==='demo@biblioteca.local'&&password==='demo1234'?['Lector de ejemplo','reader']:null;if(!a)return login('Credenciales incorrectas. Usa las cuentas de prueba.');me={email,name:a[0]};role=a[1];books=sample;users=demoUsers;return render()}let data,error;if(email.includes('@')){({data,error}=await db.auth.signInWithPassword({email,password}));if(error)return login(error.message);await loadUser(data.user)}else{const result=await db.functions.invoke('username-login',{body:{username:email,password}});if(result.error)return login('Usuario o contraseña incorrectos.');const session=result.data;if(!session?.access_token||!session?.refresh_token)return login('Respuesta de acceso no válida.');const saved=await db.auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token});if(saved.error)return login(saved.error.message);await loadUser(saved.data.user)}}
async function loadUser(u){let {data:p,error}=await db.from('profiles').select('full_name,username,role,status').eq('id',u.id).single();if(error||!p||p.status!=='active'){await db.auth.signOut();return login('Cuenta sin perfil activo.')}me={id:u.id,email:u.email,username:p.username||'',name:p.full_name||u.email};role=p.role;let docQuery=db.from('documents').select('id,title,authors,publication_year,category,page_count,size_bytes,file_fingerprint,provider,demo_path,is_published,description,collection_id,tags,isbn,publisher,metadata_source,metadata_reviewed,upload_status,metadata_status,metadata_error,original_filename,uploaded_by,metadata_match_status,metadata_confidence,metadata_candidate,document_kind,metadata_checked_at,bibliographic_identifiers,metadata_evidence').order('title');if(role!=='admin')docQuery=docQuery.eq('is_published',true);let {data:d,error:de}=await docQuery;if(de){books=[];pendingDocs=[];toast(de.message)}else{const rows=d||[];const mapDoc=(x,i)=>({id:x.id,title:metadataTitleClean(x.title),author:(x.authors||[]).join(', '),authors:x.authors||[],year:x.publication_year||'',category:x.category||'General',pages:x.page_count||'—',pageCount:x.page_count||0,size:x.size_bytes?Math.round(x.size_bytes/1024)+' KB':'—',sizeBytes:x.size_bytes||0,fileFingerprint:x.file_fingerprint||null,provider:x.provider,path:x.demo_path||'',description:x.description||'',collectionId:x.collection_id||'',tags:x.tags||[],isbn:x.isbn||'',publisher:x.publisher||'',metadataSource:x.metadata_source||'filename',metadataReviewed:!!x.metadata_reviewed,uploadStatus:x.upload_status||'stored',metadataStatus:x.metadata_status||'pending',metadataError:x.metadata_error||'',originalFilename:x.original_filename||'',metadataMatchStatus:x.metadata_match_status||'unmatched',metadataConfidence:x.metadata_confidence??null,metadataCandidate:x.metadata_candidate||null,bibliographicIdentifiers:Array.isArray(x.bibliographic_identifiers)?x.bibliographic_identifiers:[],documentKind:x.document_kind||'unknown',metadataCheckedAt:x.metadata_checked_at||null,metadataEvidence:x.metadata_evidence||{},uploadedBy:x.uploaded_by||null,tone:['sea','leaf','amber'][i%3]});books=rows.filter(x=>x.is_published).map(mapDoc);pendingDocs=role==='admin'?rows.filter(x=>!x.is_published).map(mapDoc):[];}let {data:cs}=await db.from('collections').select('id,name,description').order('name');collections=cs||[];if(role==='admin'){const {data:ud,error:ue}=await db.functions.invoke('admin-users',{body:{action:'list'}});if(ue){users=[];let detail=ue.message||'Error desconocido';try{const payload=await ue.context?.json?.();if(payload?.error)detail=payload.error}catch{}toast('No se pudo cargar la lista de usuarios: '+detail)}else users=ud?.users||[]}else users=[];render();
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
function uploadPage(){return '<div class="heading"><div><h1>Subir PDFs</h1><p>Seleccioná varios archivos. Se guardan como borradores privados y se analizan automáticamente.</p></div></div><form class="panel upload-panel" id="upload-form"><label class="upload-drop" id="upload-drop" for="upload-files"><strong>Elegí o arrastrá varios archivos PDF</strong><span>Sin límite artificial de archivos por tanda · 2 GiB por archivo</span><input id="upload-files" name="files" type="file" accept=".pdf,application/pdf" multiple required></label><div id="upload-file-list" class="upload-file-list"><span class="muted">Todavía no seleccionaste archivos.</span></div><div class="upload-note"><b>Etapa 1 · Guardado:</b> los PDFs se suben y registran en el catálogo como borradores privados. La subida usa hasta 3 archivos simultáneos. Un fallo posterior de metadatos no elimina el archivo.</div><div class="upload-note"><b>Etapa 2 · Metadatos:</b> al terminar todas las cargas, Se usa el nombre del archivo, se inspeccionan hasta 18 páginas de muestra distribuidas por todo el PDF. Se extrae texto y se buscan identificadores y líneas repetidas en encabezados y pies; no se ejecuta OCR. Se puede interrumpir y reanudar desde Administrar libros; los PDFs ya guardados permanecen disponibles.</div><div class="upload-note">Al terminar, se extraen automáticamente propiedades y texto del PDF. Para códigos editoriales BA y MEL se consulta primero el buscador oficial de Ediciones Melos. Cada ficha se valida por coincidencia exacta del campo Cod y se recuperan autor/marca, instrumento, etiquetas, colaboradores, código de barras y todos los atributos adicionales (país, medidas, letra-precio, accesorios y páginas de la edición). Los códigos de barras solo se incorporan como ISBN o ISMN si superan la validación correspondiente. Si Melos no devuelve un producto exacto, se prueban RISM e IMSLP; WorldCat queda disponible como búsqueda complementaria. Para libros se consulta primero ISBNLab y, si no devuelve una ficha, se prueban Google Books y Open Library. Para DOI/ISSN se consulta Crossref. Las coincidencias se puntúan y las dudosas quedan para revisión; también se generan etiquetas a partir de materias y datos extraídos. Cada ficha queda como borrador privado para que puedas revisarla en Administrar libros. Los archivos escaneados sin texto pueden necesitar corrección manual.</div><div class="upload-note">La detección de duplicados usa la huella SHA-256 para identificar PDFs idénticos. Coincidencias de ISBN, código editorial, título o autor pueden indicar una misma obra o edición, pero no se consideran por sí solas un archivo duplicado.</div><button class="primary" id="upload-submit" type="submit" disabled>Subir PDFs seleccionados</button><div id="upload-results" class="upload-results" aria-live="polite"></div></form>'}
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
      method:'POST',headers:{...auth,'X-File-Size':String(file.size)},
      body:JSON.stringify({fileSize:file.size,fileName:file.name.slice(0,255),fileFingerprint})
    });
    if(!start.ok)throw new Error((await start.text())||'No se pudo iniciar la carga.');
    upload=await start.json();
    if(!upload?.key||!upload?.uploadId||!Number(upload.partSize))
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
    const completionBody=upload.documentId
      ?{key:upload.key,uploadId:upload.uploadId,documentId:upload.documentId,parts,fileSize:file.size,fileName:file.name.slice(0,255),fileFingerprint}
      :{key:upload.key,uploadId:upload.uploadId,parts,fileSize:file.size,fileName:file.name.slice(0,255),fileFingerprint};
    const complete=await fetch(base+'/upload/complete',{method:'POST',headers:auth,body:JSON.stringify(completionBody)});
    if(!complete.ok)throw new Error((await complete.text())||'No se pudo finalizar la carga.');
    const result=await complete.json();upload=null;
    const savedId=result.documentId||result.document?.id;
    if(!savedId)throw new Error('La pasarela no confirmó el registro del PDF.');
    return {id:savedId,title:file.name,catalogueSynced:result.catalogueSynced!==false};
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
  // A bibliographic identity identifies a work or edition, not necessarily the same PDF.
  // Only an identical SHA-256 file fingerprint is sufficient to classify a true duplicate.
  const fingerprint=String(book.fileFingerprint||book.file_fingerprint||'').toLowerCase();
  if(!/^[0-9a-f]{64}$/.test(fingerprint))return null;
  return all.find(other=>{
    if(other.id===book.id)return false;
    const otherFingerprint=String(other.fileFingerprint||other.file_fingerprint||'').toLowerCase();
    return otherFingerprint===fingerprint;
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
  if(!rows.length)return '<tr><td colspan="9" class="empty-state">No hay libros que coincidan con este filtro.</td></tr>';
  return rows.map(b=>{
    const published=books.some(x=>x.id===b.id),collection=collections.find(x=>x.id===b.collectionId);
    const duplicate=bookDuplicateMatch(b,all),loadLabel=uploadStatusLabel(b.uploadStatus);
    const metaLabel=metadataStatusLabel(b.metadataStatus),matchLabel=metadataMatchLabel(b.metadataMatchStatus,b.metadataConfidence);
    const authorText=(b.authors||[]).join(', ')||'Autor sin identificar';
    return '<tr data-book-id="'+esc(b.id)+'"><td class="select-cell"><input type="checkbox" data-select-book="'+esc(b.id)+'" aria-label="Seleccionar '+esc(b.title)+'" '+(selectedBookIds.has(b.id)?'checked':'')+'></td><td class="book-title-cell"><span class="row-title" title="'+esc(b.title)+'">'+esc(b.title)+'</span><span class="row-author" title="'+esc(authorText)+'"> · '+esc(authorText)+'</span>'+(duplicate?'<span class="duplicate-warning" title="Posible duplicado de: '+esc(duplicate.title)+'">Duplicado</span>':'')+'</td><td class="nowrap-cell">'+esc(b.isbn||'—')+'</td><td class="nowrap-cell">'+esc(collection?.name||'—')+'</td><td class="nowrap-cell">'+(published?'<span class="pending-tag published-tag">Publicado</span>':'<span class="pending-tag">Borrador</span>')+'</td><td class="nowrap-cell"><span class="pending-tag">'+esc(loadLabel)+'</span></td><td class="metadata-compact-cell"><span class="pending-tag metadata-state">'+esc(metaLabel)+'</span><span class="row-meta-detail" title="'+esc(b.metadataError||matchLabel)+'">'+esc(matchLabel)+'</span></td><td class="nowrap-cell"><span class="row-kind">'+esc(metadataKindLabel(b.documentKind))+'</span><span class="row-category"> · '+esc(b.category||'General')+'</span></td><td class="row-actions"><button class="small-action" data-edit-doc="'+esc(b.id)+'">Editar</button>'+(b.uploadStatus==='stored'?'<button class="small-action" data-open="'+esc(b.id)+'">Ver</button>':'')+'<button class="small-action danger" data-delete-book="'+esc(b.id)+'">Eliminar</button></td></tr>';
  }).join('');
}

function booksPage(){
  const all=[...books,...pendingDocs];
  const pendingMetadata=all.filter(b=>b.provider==='r2'&&!b.metadataReviewed&&['pending','processing','partial','error'].includes(b.metadataStatus)).length;
  const reanalyzeMetadata=all.filter(b=>b.provider==='r2'&&!b.metadataReviewed&&b.uploadStatus==='stored').length;
  const unfinishedUploads=all.filter(b=>b.provider==='r2'&&b.uploadStatus!=='stored').length;
  const queueText=metadataInProgress?'Metadatos: '+metadataQueueProgress.done+'/'+metadataQueueProgress.total+' · errores: '+metadataQueueProgress.failed:(pendingMetadata?pendingMetadata+' ficha(s) pendientes de análisis':'No hay metadatos pendientes');
  return '<div class="heading"><div><h1>Administrar libros</h1><p>Los PDFs guardados se conservan aunque su ficha bibliográfica todavía no esté completa.</p></div><div class="books-admin-actions"><button class="secondary" id="reconcile-storage">Reconciliar R2 / recuperar nombres</button><button class="secondary" id="recover-local-filenames">Recuperar nombres desde carpeta local</button><input id="filename-source-folder" type="file" accept=".pdf,application/pdf" webkitdirectory directory multiple hidden><span id="filename-recovery-status" class="muted" aria-live="polite"></span><button class="primary" id="run-metadata" '+(metadataInProgress||!pendingMetadata?'disabled':'')+'>Identificar pendientes ('+pendingMetadata+')</button><button class="secondary" id="rebuild-metadata" '+(metadataInProgress||!reanalyzeMetadata?'disabled':'')+'>Identificar y revisar todos ('+reanalyzeMetadata+')</button><button class="secondary" id="stop-metadata" '+(metadataInProgress?'':'disabled')+'>Detener análisis</button></div></div><div class="metadata-queue-status" id="metadata-queue-status" aria-live="polite">'+esc(queueText)+'</div>'+(unfinishedUploads?'<p class="notice">Hay '+unfinishedUploads+' carga(s) incompleta(s). Podés revisar y eliminar los registros que no tengan PDF completo.</p>':'')+'<div class="catalog-controls books-admin-controls"><label>Buscar<input id="book-admin-search" type="search" placeholder="Título, autor, ISBN o tema"></label><label>Mostrar<select id="book-admin-status"><option value="all">Todos</option><option value="published">Publicados</option><option value="draft">Borradores privados</option></select></label></div><div class="bulk-selection-bar" id="bulk-selection-bar"><span id="bulk-selection-count">0 seleccionados</span><div><button class="secondary" id="analyze-selected-books" disabled>Analizar seleccionados</button><button class="danger-button" id="delete-selected-books" disabled>Eliminar seleccionados</button><button class="secondary" id="clear-book-selection" disabled>Limpiar selección</button></div></div><div class="panel books-admin-table-panel"><table class="pending-table books-admin-table"><thead><tr><th class="select-cell"><input type="checkbox" id="select-visible-books" aria-label="Seleccionar los libros visibles"></th><th>Libro / Autor</th><th>ISBN</th><th>Colección</th><th>Catálogo</th><th>Subida</th><th>Metadatos</th><th>Tipo / categoría</th><th>Acciones</th></tr></thead><tbody id="book-admin-rows">'+bookManagementRows()+'</tbody></table></div><p class="footnote">Las coincidencias bibliográficas se marcan como advertencia: confirmá que sean realmente el mismo libro antes de borrar o publicar.</p>';
}
function refreshMetadataQueueBanner(){
  const status=document.querySelector('#metadata-queue-status');
  if(status)status.textContent=metadataInProgress?'Metadatos: '+metadataQueueProgress.done+'/'+metadataQueueProgress.total+' · errores: '+metadataQueueProgress.failed:(metadataQueueProgress.total?'Análisis finalizado · '+metadataQueueProgress.done+'/'+metadataQueueProgress.total+' · errores: '+metadataQueueProgress.failed:'');
}

function updateBookSelectionUI(){
  const count=selectedBookIds.size,visible=[...document.querySelectorAll('#book-admin-rows [data-select-book]')];
  const header=document.querySelector('#select-visible-books');
  const selectedVisible=visible.filter(x=>x.checked).length;
  if(header){header.checked=visible.length>0&&selectedVisible===visible.length;header.indeterminate=selectedVisible>0&&selectedVisible<visible.length}
  const countLabel=document.querySelector('#bulk-selection-count');
  if(countLabel){const visibleIds=new Set(visible.map(x=>x.dataset.selectBook)),hidden=[...selectedBookIds].filter(id=>!visibleIds.has(id)).length;countLabel.textContent=count+' seleccionado(s)'+(hidden?' · '+hidden+' fuera del filtro':'')}
  const canAct=count>0&&role==='admin'&&!metadataInProgress;
  const analyze=document.querySelector('#analyze-selected-books'),remove=document.querySelector('#delete-selected-books'),clear=document.querySelector('#clear-book-selection');
  if(analyze)analyze.disabled=!canAct;
  if(remove)remove.disabled=!canAct;
  if(clear)clear.disabled=count===0;
}
function bindBookManagement(){
  const search=document.querySelector('#book-admin-search'),status=document.querySelector('#book-admin-status'),body=document.querySelector('#book-admin-rows');
  const bindActions=()=>{
    body?.querySelectorAll('[data-edit-doc]').forEach(x=>x.onclick=()=>editDocumentMetadata(x.dataset.editDoc));
    body?.querySelectorAll('[data-delete-book]').forEach(x=>x.onclick=()=>deleteDocument(x.dataset.deleteBook));
    body?.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>openBook(x.dataset.open));
    body?.querySelectorAll('[data-select-book]').forEach(x=>x.onchange=()=>{
      if(x.checked)selectedBookIds.add(x.dataset.selectBook);else selectedBookIds.delete(x.dataset.selectBook);
      updateBookSelectionUI();
    });
  };
  const refresh=()=>{if(body){body.innerHTML=bookManagementRows(search?.value||'',status?.value||'all');bindActions();updateBookSelectionUI()}};
  search?.addEventListener('input',refresh);status?.addEventListener('change',refresh);
  document.querySelector('#select-visible-books')?.addEventListener('change',e=>{
    body?.querySelectorAll('[data-select-book]').forEach(x=>{
      x.checked=e.currentTarget.checked;
      if(x.checked)selectedBookIds.add(x.dataset.selectBook);else selectedBookIds.delete(x.dataset.selectBook);
    });
    updateBookSelectionUI();
  });
  document.querySelector('#clear-book-selection')?.addEventListener('click',()=>{
    selectedBookIds.clear();refresh();
  });
  document.querySelector('#analyze-selected-books')?.addEventListener('click',()=>{
    const all=[...books,...pendingDocs],chosen=all.filter(x=>selectedBookIds.has(x.id));
    const eligible=chosen.filter(x=>x.provider==='r2'&&x.uploadStatus==='stored'&&!x.metadataReviewed);
    if(!eligible.length)return toast('No hay documentos seleccionados que puedan analizarse.');
    if(eligible.length<chosen.length)toast((chosen.length-eligible.length)+' elemento(s) omitido(s): solo se analizan PDFs guardados y sin revisión manual.');
    void runMetadataQueue(eligible.map(x=>x.id),null,true);
  });
  document.querySelector('#delete-selected-books')?.addEventListener('click',()=>void deleteSelectedDocuments([...selectedBookIds]));
  document.querySelector('#run-metadata')?.addEventListener('click',()=>runMetadataQueue());
  document.querySelector('#rebuild-metadata')?.addEventListener('click',()=>runMetadataQueue(null,null,true));
  const localRecoverButton=document.querySelector('#recover-local-filenames'),folderInput=document.querySelector('#filename-source-folder');
  localRecoverButton?.addEventListener('click',()=>folderInput?.click());
  folderInput?.addEventListener('change',()=>{const selected=[...(folderInput.files||[])];folderInput.value='';void recoverOriginalFilenamesFromFolder(selected)});
  document.querySelector('#stop-metadata')?.addEventListener('click',()=>{metadataCancelRequested=true;toast('Se detendrá la cola al terminar los documentos que ya están en proceso.')});
  document.querySelector('#reconcile-storage')?.addEventListener('click',async()=>{
    const button=document.querySelector('#reconcile-storage');if(button)button.disabled=true;
    try{
      const result=await reconcileStorageFromWorker();
      toast(result.filenameRecoveryVersion===1?('Reconciliación: '+(result.recovered||0)+' PDF(s) recuperados, '+(result.completed||0)+' cargas verificadas, '+(result.filenamesRecovered||0)+' nombres originales recuperados'+(result.filenamesUnavailable?' · '+result.filenamesUnavailable+' nombres no disponibles':'')+'.'):'La pasarela todavía no publicó la recuperación de nombres. No se modificaron archivos; volvé a intentar cuando el Worker se actualice.');
      await loadUser(me);
    }catch(error){toast('No se pudo reconciliar R2: '+error.message);if(button)button.disabled=false}
  });
  bindActions();updateBookSelectionUI();
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


async function recoverOriginalFilenamesFromFolder(files){
  if(role!=='admin'||!live)return toast('Solo el administrador puede recuperar nombres.');
  const pdfs=(files||[]).filter(f=>/\.pdf$/i.test(f.name)&&(f.type==='application/pdf'||!f.type));
  if(!pdfs.length)return toast('La carpeta seleccionada no contiene PDFs.');
  const button=document.querySelector('#recover-local-filenames'),status=document.querySelector('#filename-recovery-status');
  if(button)button.disabled=true;
  const show=(message)=>{if(status)status.textContent=message};
  try{
    show('Buscando coincidencias por tamaño…');
    const{data:rows,error}=await db.from('documents').select('id,size_bytes,file_fingerprint,original_filename')
      .eq('provider','r2').eq('upload_status','stored').not('file_fingerprint','is',null);
    if(error)throw error;
    const missing=(rows||[]).filter(x=>!String(x.original_filename||'').trim());
    const bySize=new Map();
    for(const row of missing){const size=Number(row.size_bytes);if(!bySize.has(size))bySize.set(size,[]);bySize.get(size).push(row)}
    let cursor=0,matched=0,checked=0,errors=0,skipped=0;
    const worker=async()=>{
      while(true){
        const index=cursor++;if(index>=pdfs.length)return;
        const file=pdfs[index],possible=bySize.get(file.size)||[];
        if(!possible.length){skipped++;checked++;show('Comparando '+checked+'/'+pdfs.length+' · '+matched+' nombre(s) recuperado(s)');continue}
        try{
          const fingerprint=await fingerprintFile(file);
          const matches=possible.filter(x=>x.file_fingerprint===fingerprint);
          if(matches.length){
            const{error:updateError}=await db.from('documents').update({original_filename:file.name}).in('id',matches.map(x=>x.id));
            if(updateError)throw updateError;
            for(const row of matches){row.original_filename=file.name}
            matched+=matches.length;
          }
        }catch(error){errors++;console.warn('Filename recovery failed for',file.name,error)}
        checked++;
        show('Comparando '+checked+'/'+pdfs.length+' · '+matched+' nombre(s) recuperado(s)');
      }
    };
    await Promise.all(Array.from({length:Math.min(2,pdfs.length)},worker));
    show('Finalizado · '+matched+' nombre(s) recuperado(s) · '+errors+' error(es)');
    toast('Recuperación local terminada: '+matched+' nombre(s) recuperado(s) de '+pdfs.length+' PDF(s) seleccionados.'+(errors?' · '+errors+' error(es)':'')+(skipped?' · '+skipped+' sin coincidencia por tamaño':'')+'. No se subió ningún archivo.');
    await loadUser(me);
  }catch(error){
    show('Error: '+(error?.message||'no se pudo recuperar'));
    toast('No se pudieron recuperar los nombres: '+(error?.message||'error inesperado'));
  }finally{
    if(button)button.disabled=false;
  }
}

async function runMetadataQueue(ids=null,tokenOverride=null,reprocessAll=false){
 if(metadataInProgress)return;
 const{data:{session}}=await db.auth.getSession(),token=tokenOverride||session?.access_token;if(!token)return toast('Tu sesión expiró. Inicia sesión nuevamente.');
 let request=db.from('documents').select('id,title,authors,publication_year,category,isbn,publisher,original_filename').eq('provider','r2').eq('metadata_reviewed',false).eq('upload_status','stored').order('created_at',{ascending:true}).limit(500);
 if(!reprocessAll)request=request.in('metadata_status',['pending','processing','partial','error']);if(Array.isArray(ids)&&ids.length)request=request.in('id',ids);
 const{data:documents,error}=await request;if(error)return toast('No se pudo cargar la cola de metadatos: '+error.message);const queue=documents||[];if(!queue.length)return toast('No hay PDFs pendientes para identificar.');
 metadataInProgress=true;metadataCancelRequested=false;metadataQueueProgress={done:0,total:queue.length,failed:0};updateBookSelectionUI();
 const stop=document.querySelector('#stop-metadata');if(stop)stop.disabled=false;
 const refresh=()=>{refreshMetadataQueueBanner();const s=document.querySelector('#stop-metadata');if(s)s.disabled=!metadataInProgress};refresh();
 const rowStatus=(id,message)=>document.querySelectorAll('[data-book-id="'+id+'"] .metadata-state').forEach(x=>x.textContent=message),allCandidates=[...books,...pendingDocs];let cursor=0;
 const worker=async()=>{while(true){if(metadataCancelRequested)return;const i=cursor++;if(i>=queue.length)return;const doc=queue[i];try{const{error:markError}=await db.from('documents').update({metadata_status:'processing',metadata_error:null,metadata_candidate:null,metadata_confidence:null,metadata_match_status:'unmatched'}).eq('id',doc.id);if(markError)throw markError;rowStatus(doc.id,'Identificando');await analyzeStoredDocument(doc.id,false,token,allCandidates)}catch(e){const message=String(e?.message||'Error de identificación').slice(0,500);await db.from('documents').update({metadata_status:'error',metadata_error:message}).eq('id',doc.id);metadataQueueProgress.failed++;rowStatus(doc.id,'Error · reintentar')}finally{metadataQueueProgress.done++;refresh()}}};
 await Promise.all(Array.from({length:Math.min(2,queue.length)},worker));
 const cancelled=metadataCancelRequested;metadataInProgress=false;metadataCancelRequested=false;refresh();updateBookSelectionUI();
 toast((cancelled?'Cola detenida':'Identificación terminada')+': '+metadataQueueProgress.done+'/'+metadataQueueProgress.total+' PDF(s) procesados · '+metadataQueueProgress.failed+' error(es).');
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
  if(success||recovered.recovered)void runMetadataQueue(null,session.access_token);
}
function pendingPage(){
  return '<div class="heading"><div><h1>Metadatos pendientes</h1><p>Los documentos de esta lista están guardados en privado y todavía no aparecen para los lectores.</p></div><span class="tag">'+pendingDocs.length+' pendientes</span></div><div class="notice metadata-help"><b>La ficha se analiza automáticamente</b><span>Se parte del nombre original del archivo y se inspeccionan hasta 18 páginas distribuidas por el PDF para extraer identificadores, números editoriales y datos bibliográficos. Se registran las fuentes consultadas y sus resultados. Las búsquedas por ISBN comienzan en ISBNLab y continúan con Google Books y Open Library cuando no aparece una ficha. Para búsquedas por número editorial, WorldCat ofrece una búsqueda pública por índice mn=; la consulta automática de su API requiere acceso OCLC. Son sugerencias: revisalas antes de publicar. Los PDFs escaneados sin capa de texto pueden necesitar OCR adicional.</span></div>'+(pendingDocs.length?'<div class="panel"><table class="pending-table"><tr><th>Documento (nombre provisional)</th><th>Tamaño</th><th>Estado</th><th></th></tr>'+pendingDocs.map(d=>'<tr><td>'+esc(d.title)+'</td><td>'+esc(d.size)+'</td><td><span class="pending-tag">Privado</span></td><td><button class="small-action" data-analyze-doc="'+esc(d.id)+'">Analizar PDF</button><button class="small-action" data-edit-doc="'+esc(d.id)+'">Editar ficha</button><button class="small-action" data-open="'+esc(d.id)+'">Vista previa</button><button class="small-action danger" data-delete-book="'+esc(d.id)+'">Eliminar</button></td></tr>').join('')+'</table>':'<div class="panel empty-state">No hay fichas pendientes. Cuando subas PDFs, aparecerán aquí.')+'</div>';
}

function editDocumentMetadata(id){
 const d=books.find(x=>x.id===id)||pendingDocs.find(x=>x.id===id);if(!d)return;
 const published=books.some(x=>x.id===id),candidate=d.metadataCandidate||null,m=document.createElement('div');m.className='modal-bg';
 const candidateIds=candidate?(candidate.identifierMatch?[candidate.identifierMatch]:metadataCandidateIdentifiers(candidate)).slice(0,3):[];
 const candidateIdText=candidateIds.map(x=>metadataIdentifierLabel(x.type)+': '+x.value).join(' · ')||'Sin identificadores compatibles';
 const evidence=d.metadataEvidence||{},detectedIds=(evidence.identifiers||candidate?.evidence?.identifiersFound||d.bibliographicIdentifiers||[]).map(x=>metadataIdentifierLabel(x.type)+': '+x.value);
 const repeatedSummary=(evidence.repeatedLines||candidate?.evidence?.repeatedLines||[]).slice(0,5).map(x=>x.text+' (págs. '+(x.pages||[]).join(', ')+')').join(' · ');
 const melosCatalog=evidence.melosCatalog||null;
 const melosRows=melosCatalog?[
  ['Autor/Marca',melosCatalog.author],['Instrumento',melosCatalog.instrument],['Cod',melosCatalog.code],
  ['Tags',melosCatalog.tagsText||((melosCatalog.tags||[]).join(' · '))],['Editorial',melosCatalog.publisher],
  ['Código de barras',melosCatalog.barcode],['Peso de envío',melosCatalog.shippingWeight],['Dimensiones',melosCatalog.dimensions],
  ...(melosCatalog.attributes||[]).map(x=>[x.label,x.value])
 ].filter(x=>x[1]):[];
 const melosEvidence=melosCatalog?'<div class="notice metadata-suggestion"><b>Ficha de producto · Ediciones Melos</b>'+melosRows.map(([k,v])=>'<small><b>'+esc(k)+':</b> '+esc(v)+'</small>').join('')+(melosCatalog.price?'<small>Precio de catálogo: '+esc(melosCatalog.price)+'</small>':'')+(melosCatalog.stock?'<small>Disponibilidad: '+esc(melosCatalog.stock)+'</small>':'')+(melosCatalog.url?'<small><a href="'+esc(melosCatalog.url)+'" target="_blank" rel="noopener noreferrer">Abrir ficha oficial ↗</a></small>':'')+'</div>':'';
 const lookupEvidence=evidence.catalogLookup||null,selectedLookup=lookupEvidence?.selected||null,lookupIds=(selectedLookup?.recoveredIdentifiers||[]).map(x=>metadataIdentifierLabel(x.type)+': '+x.value).join(' · ');
 const lookupAttempts=(lookupEvidence?.attempts||[]).map(x=>esc(x.source)+': '+(x.error?'error · '+esc(x.error):esc(x.note||String(x.results)+' resultado(s)'))+(x.url?' · <a href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">Abrir búsqueda ↗</a>':'')).join(' · ');
 const detectedIdentifiers=evidence.identifiers||d.bibliographicIdentifiers||[];
  const worldcatLinks=detectedIdentifiers.filter(x=>['isbn','publisher_number','oclc'].includes(x.type)).map(identifier=>{
   const value=String(identifier.value||'').trim();
   const query=identifier.type==='publisher_number'?'mn='+value.replace(/[^0-9A-Z]/gi,'').toLowerCase():value;
   return'<small><a href="https://search.worldcat.org/search?q='+encodeURIComponent(query)+'" target="_blank" rel="noopener noreferrer">Buscar '+esc(metadataIdentifierLabel(identifier.type))+': '+esc(value)+' en WorldCat ↗</a></small>';
  }).join('');
  const lookupLine=lookupEvidence?'<small>Consultas externas: '+(lookupAttempts||'Sin consultas registradas')+'</small>'+(selectedLookup?'<small>Coincidencia: '+esc(selectedLookup.source||'Catálogo')+(lookupIds?' · Identificadores recuperados: '+esc(lookupIds):'')+(selectedLookup.sourceUrl?' · <a href="'+esc(selectedLookup.sourceUrl)+'" target="_blank" rel="noopener noreferrer">Abrir registro ↗</a>':'')+'</small>':'<small>No se encontró una coincidencia exacta en las fuentes automáticas consultadas.</small>')+worldcatLinks:'';  
  const evidenceBox=(detectedIds.length||repeatedSummary||evidence.sampledPages?.length||lookupEvidence)?'<div class="notice metadata-suggestion"><b>Evidencia extraída del PDF y catálogos</b><small>Páginas examinadas: '+esc((evidence.sampledPages||candidate?.evidence?.sampledPages||[]).join(', ')||'No disponible')+' · '+esc(evidence.pageCount||'')+' páginas totales</small>'+(detectedIds.length?'<small>Identificadores detectados en el PDF: '+esc(detectedIds.join(' · '))+'</small>':'')+(repeatedSummary?'<small>Texto repetido: '+esc(repeatedSummary)+'</small>':'')+lookupLine+'</div>':'';
 const box=candidate?'<div class="notice metadata-suggestion"><b>Sugerencia de '+esc(candidate.source||'catálogo')+' · '+esc(candidate.score||0)+'/100</b><p>'+esc(candidate.title||'Sin título')+' · '+esc((candidate.authors||[]).join(', ')||'Autor no identificado')+' · '+esc(candidate.year||'Año sin indicar')+'</p><small>'+esc(candidateIdText)+' · Editorial: '+esc(candidate.publisher||'No informada')+'</small>'+(detectedIds.length?'<small>Detectado en el PDF: '+esc(detectedIds.join(' · '))+'</small>':'')+(repeatedSummary?'<small>Texto repetido: '+esc(repeatedSummary)+'</small>':'')+(candidate.sourceUrl?'<small><a href="'+esc(candidate.sourceUrl)+'" target="_blank" rel="noopener noreferrer">Abrir ficha del producto ↗</a></small>':'')+'<button type="button" class="secondary" id="use-catalog-candidate">Usar esta sugerencia en el formulario</button></div>':'';
 m.innerHTML='<section class="modal metadata-modal"><header><b>Ficha bibliográfica</b><button id="close" type="button">Cerrar ×</button></header>'+box+evidenceBox+melosEvidence+'<form id="metadata-form"><label>Título<input name="title" maxlength="300" required value="'+esc(d.title)+'"></label><label>Autor/es<input name="authors" maxlength="1000" value="'+esc(d.authors.join(', '))+'" placeholder="Separar varios autores con coma"></label><div class="upload-grid"><label>Tipo de documento<select name="documentKind">'+[['unknown','Sin clasificar'],['book','Libro'],['academic','Tesis / trabajo académico'],['article','Artículo'],['music_score','Partitura / cancionero'],['periodical','Revista / publicación periódica'],['manual','Manual / guía'],['reference','Obra de referencia'],['other','Otro documento']].map(([v,t])=>'<option value="'+v+'" '+((d.documentKind||'unknown')===v?'selected':'')+'>'+t+'</option>').join('')+'</select></label><label>Categoría<input name="category" maxlength="100" value="'+esc(d.category)+'" required></label><label>Año de publicación<input name="publicationYear" type="number" min="1000" max="2100" value="'+esc(d.year)+'" placeholder="Opcional"></label><label>Colección<select name="collectionId"><option value="">Sin colección</option>'+collections.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===d.collectionId?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></label><label>Cantidad de páginas<input name="pageCount" type="number" min="1" max="100000" value="'+esc(d.pageCount||'')+'" placeholder="Opcional"></label><label>ISBN<input name="isbn" maxlength="32" value="'+esc(d.isbn||'')+'"></label><label>Editorial<input name="publisher" maxlength="200" value="'+esc(d.publisher||'')+'"></label></div><label>Otros identificadores bibliográficos<textarea name="bibliographicIdentifiers" rows="4" maxlength="2000" placeholder="ISSN: 1234-567X&#10;DOI: 10.xxxx/xxxxx&#10;ISMN: 9790...&#10;Número editorial: BA 11111 o MEL9152">'+esc(metadataFormatIdentifiers(d.bibliographicIdentifiers||[]))+'</textarea><small>Un identificador por línea. Se admiten ISBN, ISSN, DOI, ISMN, ISWC, OCLC y números editoriales o de plancha, incluidos BA y MEL de Ediciones Melos.</small></label><label>Temas / etiquetas<input name="tags" maxlength="1000" value="'+esc((d.tags||[]).join(', '))+'" placeholder="guitarra, armonía, piano…"></label><label>Descripción<textarea name="description" rows="4" maxlength="3000">'+esc(d.description)+'</textarea></label><p class="muted">Origen: '+esc(metadataSourceLabel(d.metadataSource||'filename'))+' · Coincidencia: '+esc(metadataMatchLabel(d.metadataMatchStatus,d.metadataConfidence))+' · Tipo probable: '+esc(metadataKindLabel(d.documentKind))+'</p><div class="metadata-actions"><button class="secondary" id="save-private" type="button">'+(published?'Guardar cambios':'Guardar sin publicar')+'</button><button class="primary" id="publish-toggle" type="button">'+(published?'Guardar y retirar del catálogo':'Guardar y publicar')+'</button></div></form></section>';
 document.body.append(m);m.querySelector('#close').onclick=()=>m.remove();m.onclick=e=>{if(e.target===m)m.remove()};
 const use=m.querySelector('#use-catalog-candidate');if(use)use.onclick=()=>{
  const form=m.querySelector('#metadata-form'),set=(n,v)=>{const field=form.elements.namedItem(n);if(field&&v!==undefined&&v!==null&&v!=='')field.value=v};
  set('title',candidate.title);set('authors',(candidate.authors||[]).join(', '));set('publicationYear',candidate.year);set('isbn',(candidate.isbns||[]).find(x=>metadataValidIsbn(x))||'');set('publisher',candidate.publisher);set('description',candidate.description);set('tags',(candidate.tags||[]).join(', '));set('pageCount',candidate.pageCount);
  const kind=candidate.documentKind||(candidate.printType==='BOOK'?'book':'unknown');
  set('documentKind',kind);set('category',metadataCategoryFromTags(candidate.tags||[],kind));
  if(candidate.identifiers?.length)set('bibliographicIdentifiers',metadataFormatIdentifiers(metadataUniqueIdentifiers([...(d.bibliographicIdentifiers||[]),...candidate.identifiers])));
  toast('Sugerencia cargada. Revisá título, autor e identificadores antes de guardar.');
 };
 const save=async publish=>{
  const data=new FormData(m.querySelector('#metadata-form')),title=String(data.get('title')||'').trim(),year=String(data.get('publicationYear')||''),pages=String(data.get('pageCount')||''),kind=String(data.get('documentKind')||'unknown');
  const parsedIdentifiers=metadataParseIdentifierInput(String(data.get('bibliographicIdentifiers')||''));
  const previousIdentifiers=d.bibliographicIdentifiers||[];
  const identifierList=parsedIdentifiers.map(item=>{
   const prior=previousIdentifiers.find(old=>old.type===item.type&&metadataNormalizeIdentifier(old.type,old.value)===item.normalized);
   return prior?{...prior,value:item.value,normalized:item.normalized}:{...item,source:'manual'};
  });
  const isbnText=String(data.get('isbn')||'').trim(),validIsbn=isbnText?metadataValidIsbn(isbnText):null;
  if(isbnText&&!validIsbn)return toast('El ISBN ingresado no supera la validación de dígitos.');
  if(validIsbn)identifierList.push({type:'isbn',value:validIsbn,normalized:validIsbn,source:'manual',pages:[],occurrences:0,confidence:100});
  const identifiers=metadataUniqueIdentifiers(identifierList),savedIsbn=validIsbn||identifiers.find(x=>x.type==='isbn')?.value||null;
  const values={title,authors:String(data.get('authors')||'').split(',').map(x=>x.trim()).filter(Boolean),publication_year:year?Number(year):null,category:String(data.get('category')||'General').trim()||'General',description:String(data.get('description')||'').trim(),collection_id:String(data.get('collectionId')||'')||null,page_count:pages?Number(pages):null,isbn:savedIsbn,publisher:String(data.get('publisher')||'').trim()||null,tags:String(data.get('tags')||'').split(',').map(x=>x.trim()).filter(Boolean),bibliographic_identifiers:identifiers,document_kind:kind,metadata_source:'manual',metadata_reviewed:true,metadata_status:'complete',metadata_error:null,metadata_match_status:['other','periodical','article'].includes(kind)?'non_book':'matched',metadata_confidence:100,metadata_candidate:null,metadata_checked_at:new Date().toISOString(),is_published:publish};
  if(!title)return toast('El título es obligatorio.');
  if(values.publication_year!==null&&(!Number.isInteger(values.publication_year)||values.publication_year<1000||values.publication_year>2100))return toast('Revisá el año.');
  if(values.page_count!==null&&(!Number.isInteger(values.page_count)||values.page_count<1||values.page_count>100000))return toast('Revisá las páginas.');
  const{error}=await db.from('documents').update(values).eq('id',id);
  if(error)return toast('No se pudo guardar: '+error.message);
  m.remove();toast(publish?'Ficha publicada.':published?'Cambios guardados y retirado del catálogo.':'Ficha guardada como borrador.');await loadUser(me);
 };
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
  const downloadGateway=gateway+'?download=1';
  const safeName=metadataTitleClean(b.title||'documento').replace(/[\\/:*?"<>|]+/g,'_').trim()||'documento';
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
      const response=await fetch(downloadGateway,{headers:{Authorization:'Bearer '+session.access_token}});
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
      download.href=objectUrl;
      download.download=filename;
      download.title='Guardar como '+filename;
      download.setAttribute('aria-label','Descargar '+filename);
      download.textContent='Descargar PDF';
      download.hidden=false;
      status.textContent='PDF original abierto. Para conservar el nombre "'+filename+'", usá el botón Descargar PDF de esta ventana.';
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

async function deleteSelectedDocuments(ids){
  if(role!=='admin'||metadataInProgress)return;
  const unique=[...new Set(ids)].filter(Boolean),all=[...books,...pendingDocs],targets=unique.map(id=>all.find(x=>x.id===id)).filter(Boolean);
  if(!targets.length)return toast('No hay documentos seleccionados.');
  const preview=targets.slice(0,4).map(x=>x.title).join(' · '),extra=targets.length>4?' y '+(targets.length-4)+' más':'';
  if(!confirm('Vas a eliminar definitivamente '+targets.length+' documento(s) y sus archivos PDF privados.\n\n'+preview+extra+'\n\nEsta acción no se puede deshacer. ¿Continuar?'))return;
  const{data:{session}}=await db.auth.getSession();
  if(!session?.access_token)return login('Tu sesión expiró. Inicia sesión nuevamente.');
  const button=document.querySelector('#delete-selected-books');if(button)button.disabled=true;
  const base=(c.pdfGatewayUrl||'').replace(/\/+$/,''),token=session.access_token;
  let cursor=0,deleted=0,failed=[],cleanupPending=[];
  const worker=async()=>{
    while(true){
      const index=cursor++;if(index>=targets.length)return;
      const doc=targets[index];
      try{
        const response=await fetch(base+'/document/'+encodeURIComponent(doc.id),{method:'DELETE',headers:{Authorization:'Bearer '+token}});
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result.error||'No se pudo eliminar');
        selectedBookIds.delete(doc.id);deleted++;
        if(result.storageCleanupPending)cleanupPending.push(doc.title);
      }catch(error){failed.push(doc.title+' ('+(error?.message||'error')+')')}
      if(button)button.textContent='Eliminando '+deleted+'/'+targets.length+'…';
    }
  };
  await Promise.all(Array.from({length:Math.min(3,targets.length)},worker));
  if(button)button.textContent='Eliminar seleccionados';
  await loadUser(me);
  const details=[...failed.map(x=>'No eliminado: '+x),...cleanupPending.map(x=>'Registro eliminado; limpiar objeto R2: '+x)];
  toast('Eliminación terminada: '+deleted+'/'+targets.length+' documento(s).'+(details.length?' '+details.join('; ').slice(0,500):''));
}

async function deleteDocument(id){const d=books.find(x=>x.id===id)||pendingDocs.find(x=>x.id===id);if(!d||role!=='admin')return;if(!confirm('¿Eliminar definitivamente "'+d.title+'" y su PDF privado? Esta acción no se puede deshacer.'))return;const {data:{session}}=await db.auth.getSession();if(!session?.access_token)return login('Tu sesión expiró.');const base=(c.pdfGatewayUrl||'').replace(/\/+$/,'');try{const response=await fetch(base+'/document/'+encodeURIComponent(id),{method:'DELETE',headers:{Authorization:'Bearer '+session.access_token}});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'No se pudo eliminar.');selectedBookIds.delete(id);toast(result.storageCleanupPending?'Registro eliminado; el almacenamiento requiere limpieza manual.':'Documento y archivo eliminados.');await loadUser(me)}catch(error){toast('Error al eliminar: '+error.message)}}
function metadataTextKey(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function metadataTitleClean(value){
 return String(value||'').replace(/\s+/g,' ').trim()
  .replace(/\s*(?:p[aá]g(?:ina)?\.?\s*\d+|page\s+\d+)\s*$/i,'')
  .replace(/\s*\|\s*(?:BA|MEL)\s*[-.]?\s*\d{3,8}\s*$/i,'')
  .trim();
}
function metadataTitleUsable(value){
  const title=metadataTitleClean(value),key=metadataTextKey(title);
  if(title.length<4||title.length>180||title.includes('�')||(/�/g.test(title)&&((title.match(/�/g)||[]).length>1)))return false;
  if(/copyright|derechos reservados|isbn|issn|catalogaci[oó]n|catalogacion|c[oó]digo de catalogaci[oó]n|copyright|impreso en|printed in|buenos aires.{0,30}argentina/i.test(title))return false;
  if(/^(?:versi[oó]n comisionada por sadaic|vol(?:ume)?\.?\s*\d|n[úu]mero\s*\d|contents|[íi]ndice|contenido|bibliograf[ií]a|editorial|ediciones|published by|www\.|https?:)/i.test(title))return false;
  if(/^(?:\d+\s*)?ba\s*[-.]?\s*\d{3,}$/i.test(title)||/^d\s+y\s+k\s+i\s+n\s+s\s+o\s+n/i.test(title))return false;
  if(/^c[oó]digo de catalogaci[oó]n/i.test(title)||/^versi[oó]n comisionada/i.test(title))return false;
  if(key.split(' ').filter(Boolean).length<1)return false;
  return true;
}
function metadataNameLike(value){
  const s=String(value||'').replace(/[©®].*$/,'').trim(),words=s.split(/\s+/).filter(Boolean);
  if(words.length<2||words.length>5||/copyright|buenos aires|argentina|editorial|ricordi|musicales|sadaic|isbn/i.test(s))return false;
  const connectors=new Set(['de','del','la','las','los','y','e','da','do','van','von','the','of']);
  const cleanWords=words.map(w=>w.replace(/,$/,''));
  const valid=cleanWords.filter(w=>!connectors.has(w.toLowerCase())).every(w=>/^(?:[A-ZÁÉÍÓÚÜÑ]\.?|[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ.'’\-]+)$/.test(w));
  return valid&&cleanWords.filter(w=>!connectors.has(w.toLowerCase())).length>=2;
}
function metadataAuthorClean(value){
  let s=String(value||'').replace(/(?:©|copyright|derechos reservados).*/i,'').replace(/\s+/g,' ').trim();
  s=s.replace(/^(?:autor(?:es)?|por|escrito por|written by|by|compositor(?:es)?|composer|composed by|m[uú]sica de|letra y m[uú]sica|arr(?:eglo)?(?: de| by)?)\s*[:\-]?\s*/i,'').trim();
  return s;
}
function metadataAuthorUsable(value){
  const s=metadataAuthorClean(value);
  return !!s&&s.length<=120&&!/[�]/.test(s)&&!/[.!?].{20,}/.test(s)&&metadataNameLike(s);
}
function metadataValidIsbn(value){
  const v=String(value||'').replace(/[^0-9Xx]/g,'').toUpperCase();
  if(v.length===13&&/^(?:978\d{10}|979[1-9]\d{9})$/.test(v)){
    let sum=0;for(let i=0;i<12;i++)sum+=Number(v[i])*(i%2?3:1);
    return (10-sum%10)%10===Number(v[12])?v:null;
  }
  if(v.length===10&&/^\d{9}[\dX]$/.test(v)){
    let sum=0;for(let i=0;i<9;i++)sum+=Number(v[i])*(10-i);
    sum+=v[9]==='X'?10:Number(v[9]);
    return sum%11===0?v:null;
  }
  return null;
}
function metadataValidIsmn(value){
  const raw=String(value||'').trim().toUpperCase();
  const compact=raw.replace(/[^0-9]/g,'');
  if(/^9790\d{9}$/.test(compact)){
    let sum=0;for(let i=0;i<12;i++)sum+=Number(compact[i])*(i%2?3:1);
    return (10-sum%10)%10===Number(compact[12])?compact:null;
  }
  if(/^M[- ]?\d{4}[- ]?\d{4}[- ]?[0-9X]$/.test(raw)){
    return 'M-'+raw.replace(/^M[- ]?/,'').replace(/[- ]/g,'').replace(/^(.{4})(.{4})(.)$/,'$1-$2-$3');
  }
  return null;
}
function metadataValidIssn(value){
  const v=String(value||'').replace(/[^0-9Xx]/g,'').toUpperCase();
  if(!/^\d{7}[\dX]$/.test(v))return null;
  let sum=0;for(let i=0;i<7;i++)sum+=Number(v[i])*(8-i);
  const check=(11-sum%11)%11,expected=check===10?'X':String(check);
  return expected===v[7]?v.slice(0,4)+'-'+v.slice(4):null;
}
function metadataNormalizeDoi(value){
  return String(value||'').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi\s*:\s*/i,'').replace(/[.,;:!?)\]}]+$/g,'').toLowerCase();
}
function metadataNormalizeIdentifier(type,value){
  const raw=String(value||'').trim();
  if(type==='isbn')return metadataValidIsbn(raw)||raw.replace(/[^0-9Xx]/g,'').toUpperCase();
  if(type==='ismn')return metadataValidIsmn(raw)||raw.replace(/[^0-9A-Z]/g,'').toUpperCase();
  if(type==='issn')return metadataValidIssn(raw)||raw.replace(/[^0-9Xx]/g,'').toUpperCase();
  if(type==='doi')return metadataNormalizeDoi(raw);
  if(type==='publisher_number'){const upper=raw.toUpperCase(),compact=upper.replace(/[^A-Z0-9]/g,'');if(/^(?:BA|MEL)\d+$/.test(compact))return compact;return upper.replace(/\s+/g,' ').replace(/\s*([-./])\s*/g,'$1').trim();}
  if(type==='iswc')return raw.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(type==='oclc')return raw.replace(/[^0-9]/g,'');
  return raw;
}
function metadataIdentifierLabel(type){
  return({isbn:'ISBN',issn:'ISSN',doi:'DOI',ismn:'ISMN',iswc:'ISWC',isrc:'ISRC',oclc:'OCLC',publisher_number:'Número editorial / de plancha'})[type]||String(type||'Identificador');
}
function metadataUniqueIdentifiers(items){
  const map=new Map();
  for(const item of items||[]){
    if(!item?.type||!item?.value)continue;
    const type=String(item.type),value=String(item.value).trim(),normalized=item.normalized||metadataNormalizeIdentifier(type,value);
    if(!normalized)continue;
    const key=type+':'+normalized,old=map.get(key);
    if(old){
      old.pages=[...new Set([...(old.pages||[]),...(item.pages||[])])].sort((a,b)=>a-b);
      old.occurrences=Math.max(old.occurrences||0,item.occurrences||0);
      if(item.confidence)old.confidence=Math.max(old.confidence||0,item.confidence);
    }else map.set(key,{type,value,normalized,source:item.source||'pdf_text',pages:[...(item.pages||[])],occurrences:item.occurrences||0,confidence:item.confidence||null});
  }
  return [...map.values()];
}
function metadataExtractPublisherNumbers(pageLines){
  const found=new Map();
  const patterns=[
    /\b(?:BA\s*[-.]?\s*\d{4,7}(?:[-.]\d{2,3})?|MEL\s*[-.]?\s*\d{3,8})\b/gi,
    /\b(?:Bestell[- ]?(?:Nr\.?|Nummer)|Verlags[- ]?(?:Nr\.?|Nummer)|Publisher(?:'s)?\s*(?:No\.?|Number)|Plate\s*(?:No\.?|Number)|Plattennummer|Número\s+de\s+plancha|Cat(?:alogue|alog)?\s*(?:No\.?|Number))\s*[:#-]?\s*([A-Z]{1,5}\s*[-.]?\s*\d{3,8}(?:[-.]\d{2,3})?)/gi
  ];
  for(const line of pageLines||[]){
    for(let pi=0;pi<patterns.length;pi++){
      const re=new RegExp(patterns[pi].source,patterns[pi].flags);let m;
      while((m=re.exec(line.text||''))){
        const raw=(pi===0?m[0]:m[1]).replace(/\s+/g,' ').trim().toUpperCase();
        const normalized=metadataNormalizeIdentifier('publisher_number',raw),key=normalized;
        if(!found.has(key))found.set(key,{type:'publisher_number',value:raw,normalized,pages:new Set(),occurrences:0,source:'pdf_text',confidence:0});
        const record=found.get(key);record.pages.add(line.page);record.occurrences++;
        if(pi===0)record.confidence=Math.max(record.confidence,72);
        if(pi===1)record.confidence=Math.max(record.confidence,80);
      }
    }
  }
  return [...found.values()].filter(x=>x.pages.size>=2||x.confidence>=72).map(x=>({
    type:x.type,value:x.value,normalized:x.normalized,source:x.source,pages:[...x.pages].sort((a,b)=>a-b),
    occurrences:x.occurrences,confidence:x.pages.size>=3?96:x.pages.size>=2?88:x.confidence
  }));
}
function metadataExtractIdentifiers(text,pageLines=[]){
  const source=String(text||''),found=[];
  const add=(type,value)=>{
    const normalized=metadataNormalizeIdentifier(type,value);if(!normalized)return;
    const needle=String(value).replace(/[^0-9A-Za-z]/g,'').toUpperCase();
    const pages=[...new Set((pageLines||[]).filter(line=>String(line.text||'').replace(/[^0-9A-Za-z]/g,'').toUpperCase().includes(needle)).map(line=>line.page))];
    found.push({type,value:String(value).trim(),normalized,source:'pdf_text',pages,occurrences:pages.length,confidence:pages.length>=2?92:75});
  };
  let m;
  const issnRe=/\bISSN(?:-L)?\s*[:#]?\s*([0-9Xx][0-9Xx\s-]{7,14})/ig;
  while((m=issnRe.exec(source))){const v=metadataValidIssn(m[1]);if(v)add('issn',v)}
  const doiRe=/(?:\bdoi\s*:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[0-9A-Z._;()/:+-]+)/ig;
  while((m=doiRe.exec(source))){const v=metadataNormalizeDoi(m[1]);if(v)add('doi',v)}
  const ismnLabeled=/\bISMN\s*[:#-]?\s*(M[- ]?\d{4}[- ]?\d{4}[- ]?[0-9Xx]|979[- ]?0(?:[- ]?\d){9})/ig;
  while((m=ismnLabeled.exec(source))){const v=metadataValidIsmn(m[1]);if(v)add('ismn',v)}
  for(const raw of source.match(/\b979[ -]?0(?:[ -]?\d){9}\b/g)||[]){const v=metadataValidIsmn(raw);if(v)add('ismn',v)}
  const iswcRe=/\bISWC\s*[:#-]?\s*(T[- ]?\d{3}[. -]?\d{3}[. -]?\d{3}[-. ]?\d)\b/ig;
  while((m=iswcRe.exec(source)))add('iswc',m[1]);
  const oclcRe=/\bOCLC(?:\s*(?:No\.?|number))?\s*[:#]?\s*(\d{5,12})\b/ig;
  while((m=oclcRe.exec(source)))add('oclc',m[1]);
  const isbnRe=/\bISBN(?:-1[03])?\s*[:#-]?\s*([0-9Xx][0-9Xx\s-]{8,24})/ig;
  while((m=isbnRe.exec(source))){const v=metadataValidIsbn(m[1]);if(v)add('isbn',v)}
  for(const item of source.match(/\b(?:97[89](?:[\s-]?\d){10}|(?:\d[\s-]?){9}[\dXx])\b/g)||[]){const v=metadataValidIsbn(item);if(v)add('isbn',v)}
  return metadataUniqueIdentifiers([...found,...metadataExtractPublisherNumbers(pageLines)]);
}
function metadataExtractRepeatedLines(pageLines){
  const map=new Map();
  for(const line of pageLines||[]){
    const value=String(line.text||'').replace(/\s+/g,' ').trim(),key=metadataTextKey(value);
    if(value.length<8||value.length>180||!key||/^\d+$/.test(key))continue;
    if(!map.has(key))map.set(key,{text:value,pages:new Set()});
    map.get(key).pages.add(line.page);
  }
  return [...map.values()].filter(x=>x.pages.size>=2)
    .sort((a,b)=>b.pages.size-a.pages.size||b.text.length-a.text.length)
    .slice(0,16).map(x=>({text:x.text,pages:[...x.pages].sort((a,b)=>a-b),pageCount:x.pages.size}));
}
function metadataSamplePages(total,maxPages=18){
  const count=Math.max(0,Number(total)||0);if(!count)return[];
  if(count<=maxPages)return Array.from({length:count},(_,i)=>i+1);
  const pages=new Set();for(let p=1;p<=Math.min(8,count);p++)pages.add(p);
  const extra=maxPages-pages.size;
  for(let i=0;i<extra;i++)pages.add(Math.min(count,9+Math.round(i*(count-9)/Math.max(1,extra-1))));
  return [...pages].sort((a,b)=>a-b).slice(0,maxPages);
}
function metadataParseIdentifierInput(value){
  const output=[];
  for(const line of String(value||'').split(/[\n;]+/).map(x=>x.trim()).filter(Boolean)){
    let type='',raw='';
    const labelled=line.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
    if(labelled){const label=metadataTextKey(labelled[1]);raw=labelled[2].trim();
      if(label==='isbn'||label==='isbn 10'||label==='isbn 13')type='isbn';
      else if(label.startsWith('issn'))type='issn';
      else if(label==='doi')type='doi';
      else if(label==='ismn')type='ismn';
      else if(label==='iswc')type='iswc';
      else if(label==='oclc')type='oclc';
      else type='publisher_number';
    }else if(/^(?:BA\s*[-.]?\s*\d{4,7}|MEL\s*[-.]?\s*\d{3,8})/i.test(line)){type='publisher_number';raw=line}
    else continue;
    const normalized=metadataNormalizeIdentifier(type,raw);
    if(normalized&&raw)output.push({type,value:raw,normalized,source:'manual',pages:[],occurrences:0,confidence:100});
  }
  return metadataUniqueIdentifiers(output);
}
function metadataFormatIdentifiers(items){
  return (items||[]).map(x=>metadataIdentifierLabel(x.type)+': '+String(x.value||'')).join('\n');
}
function metadataExtractIsbn(text){
  return metadataExtractIdentifiers(text,[]).find(x=>x.type==='isbn')?.value||null;
}
function metadataExtractYear(text){const m=String(text||'').match(/(?:edici[oó]n(?:\s+(?:de|del|año))?|publicad[oa]|publicaci[oó]n|impres[oa]|printed|published|primera edici[oó]n)\D{0,35}((?:18|19|20)\d{2})/i);return m?Number(m[1]):null}
function metadataPageLines(items,pageNumber){
  const entries=(items||[]).filter(x=>String(x.str||'').trim()).map(x=>{
    const tr=x.transform||[],font=Math.max(1,Number(x.height)||Math.hypot(Number(tr[2])||0,Number(tr[3])||0)||1);
    return {text:String(x.str||'').trim(),x:Number(tr[4])||0,y:Number(tr[5])||0,font};
  }).sort((a,b)=>b.y-a.y||a.x-b.x);
  const groups=[];
  for(const entry of entries){
    let group=groups.find(g=>Math.abs(g.y-entry.y)<=Math.max(2,Math.min(4,entry.font*.22)));
    if(!group){group={y:entry.y,items:[]};groups.push(group)}
    group.items.push(entry);
  }
  return groups.map(g=>{
    const parts=g.items.sort((a,b)=>a.x-b.x),text=parts.map(x=>x.text).join(' ').replace(/\s+/g,' ').trim();
    return {text,page:pageNumber,y:g.y,font:Math.max(...parts.map(x=>x.font))};
  }).filter(x=>x.text.length>1);
}
function metadataTitleIsSpecific(value){
  const words=metadataTextKey(value).split(' ').filter(x=>x.length>1);
  return words.length>=2&&words.some(x=>x.length>=3);
}
function metadataTitleSimilarity(a,b){
  const aa=metadataTextKey(a).split(' ').filter(x=>x.length>1),bb=metadataTextKey(b).split(' ').filter(x=>x.length>1);
  if(!aa.length||!bb.length)return 0;
  if(aa.join(' ')===bb.join(' '))return 1;
  const uniqueA=[...new Set(aa)],uniqueB=[...new Set(bb)],common=uniqueA.filter(x=>uniqueB.includes(x)).length;
  return common/Math.max(uniqueA.length,uniqueB.length);
}
let openLibraryRequestChain=Promise.resolve(),openLibraryLastRequest=0;
async function openLibraryFetch(url){
  const request=openLibraryRequestChain.then(async()=>{
    const wait=Math.max(0,1000-(Date.now()-openLibraryLastRequest));
    if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    openLibraryLastRequest=Date.now();
    return fetch(url,{signal:AbortSignal.timeout(9000)});
  });
  openLibraryRequestChain=request.catch(()=>null);
  return request;
}

function metadataParseFilename(filename){
 const raw=metadataTitleClean(String(filename||'').split(/[\\/]/).pop()||'').replace(/\.pdf$/i,'').replace(/[_]+/g,' ').replace(/\s+/g,' ').trim(),title=raw;let authors=[];
 const by=raw.match(/^(.+?)\s+(?:por|by)\s+(.+)$/i);
 if(by&&metadataTitleUsable(by[1])){if(metadataNameLike(by[2]))authors=[metadataAuthorClean(by[2])];return{raw,title:metadataTitleClean(by[1]),authors:authors.filter(metadataAuthorUsable)}}
 const parts=raw.split(/\s+(?:[-–—|])\s+/).map(metadataTitleClean).filter(Boolean);
 if(parts.length===2){const l=metadataNameLike(parts[0]),r=metadataNameLike(parts[1]);if(r&&!l){authors=[metadataAuthorClean(parts[1])];return{raw,title:parts[0],authors:authors.filter(metadataAuthorUsable)}}if(l&&!r){authors=[metadataAuthorClean(parts[0])];return{raw,title:parts[1],authors:authors.filter(metadataAuthorUsable)}}}
 return{raw,title:metadataTitleUsable(title)?title:raw,authors:[]};
}
function metadataAuthorsMatch(expected,found){
 if(!expected?.length||!found?.length)return false;
 const norm=values=>values.map(x=>metadataTextKey(x)).filter(Boolean);
 const a=norm(expected),b=norm(found);
 return a.some(x=>b.some(y=>x===y||(x.split(' ').length>=2&&y.split(' ').length>=2&&x.split(' ').slice(-1)[0]===y.split(' ').slice(-1)[0]&&x.split(' ').slice(-1)[0].length>3)));
}

function metadataCleanDescription(v){return String(v||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim().slice(0,3000)}
function metadataCandidateIdentifiers(candidate){
 if(Array.isArray(candidate.identifiers))return candidate.identifiers;
 return (candidate.isbns||[]).map(value=>({type:'isbn',value,normalized:metadataNormalizeIdentifier('isbn',value)}));
}
function metadataRankCandidate(candidate,context){
 const titleScore=metadataTitleSimilarity(context.title,candidate.title),candidateIds=metadataCandidateIdentifiers(candidate),contextIds=context.identifiers||[];
 let identifierMatch=null;
 for(const id of contextIds){
  if(candidateIds.some(other=>other.type===id.type&&metadataNormalizeIdentifier(other.type,other.value)===metadataNormalizeIdentifier(id.type,id.value))){identifierMatch=id;break}
 }
 const isbnMatch=!!(context.isbn&&candidate.isbns?.some(x=>metadataValidIsbn(x)===context.isbn))||identifierMatch?.type==='isbn';
 if(!identifierMatch&&isbnMatch)identifierMatch={type:'isbn',value:context.isbn,normalized:context.isbn};
 const authorMatch=metadataAuthorsMatch(context.authors,candidate.authors||[]);
 const specific=metadataTitleIsSpecific(context.title)&&metadataTitleIsSpecific(candidate.title);
 let score;
 if(identifierMatch?.type==='publisher_number'){
  // Exact publisher codes identify a specific edition and remain authoritative.
  score=titleScore>=.6?100:titleScore>=.35?96:92;
 }else if(identifierMatch?.type==='isbn'){
  // Some publishers reuse one ISBN across multiple works in a collection.
  // An ISBN hit is accepted only when the title independently corroborates it.
  const titleCompatible=metadataTitleIsSpecific(context.title)&&metadataTitleIsSpecific(candidate.title)&&titleScore>=.6;
  score=titleCompatible?(titleScore>=.75?100:92):74;
 }else if(identifierMatch){
  const compatible=!metadataTitleIsSpecific(context.title)||titleScore>=.35;
  score=compatible?(titleScore>=.6?100:92):38;
 }else{
  score=specific?Math.round(titleScore*66+(context.authors?.length?(authorMatch?28:0):8)+(context.publisher&&candidate.publisher&&metadataTextKey(context.publisher)===metadataTextKey(candidate.publisher)?4:0)+(context.year&&candidate.year===context.year?2:0)):Math.round(titleScore*50);
  if(context.authors?.length&&!authorMatch)score=Math.min(score,74);
  if(!context.authors?.length)score=Math.min(score,78);
  if(!specific)score=Math.min(score,65);
 }
 return{...candidate,score,titleSimilarity:Number(titleScore.toFixed(3)),authorMatch,isbnMatch,identifierMatch:identifierMatch||null,identifierType:identifierMatch?.type||null};
}
function metadataCandidateAccepted(candidate){
 return !!candidate&&candidate.score>=92&&(
  (!!candidate.identifierMatch&&candidate.score>=92)||
  (candidate.titleSimilarity>=.88&&candidate.authorMatch&&metadataTitleIsSpecific(candidate.title))
 );
}

function metadataCandidateFromGoogle(item){
 const v=item?.volumeInfo||{},ids=(v.industryIdentifiers||[]).map(x=>metadataValidIsbn(x.identifier)).filter(Boolean),date=String(v.publishedDate||'').match(/(?:18|19|20)\d{2}/);
 return{title:metadataTitleClean(v.title||''),authors:(v.authors||[]).map(metadataAuthorClean).filter(metadataAuthorUsable),isbns:[...new Set(ids)],identifiers:[...new Set(ids)].map(value=>({type:'isbn',value,normalized:value})),publisher:String(v.publisher||''),year:date?Number(date[0]):null,description:metadataCleanDescription(v.description),tags:(v.categories||[]).flatMap(x=>String(x).split(/[\/;|]/)).map(x=>x.trim()).filter(Boolean).slice(0,30),pageCount:v.pageCount||null,source:'Google Books',printType:String(v.printType||'').toUpperCase(),sourceId:item?.id||null};
}

function metadataCandidateFromIsbnLab(book, queriedIsbn) {
 const returnedIsbns=[book?.isbn10,book?.isbn13].map(metadataValidIsbn).filter(Boolean);
 const isbns=[...new Set([queriedIsbn,...returnedIsbns].filter(Boolean))];
 const authors=(Array.isArray(book?.authors)?book.authors:[])
  .map(x=>metadataAuthorClean(typeof x==="string"?x:x?.name||""))
  .filter(metadataAuthorUsable);
 const publishers=(Array.isArray(book?.publishers)?book.publishers:[])
  .map(x=>typeof x==="string"?x:x?.name||"").filter(Boolean);
 const imprint=(Array.isArray(book?.imprint)?book.imprint:[])
  .map(x=>typeof x==="string"?x:x?.name||"").filter(Boolean);
 const subjects=(Array.isArray(book?.subjects)?book.subjects:[])
  .map(x=>typeof x==="string"?x:x?.name||"").filter(Boolean);
 const genres=(Array.isArray(book?.genres)?book.genres:[])
  .map(x=>typeof x==="string"?x:x?.name||"").filter(Boolean);
 const date=String(book?.publishDate||"").match(/(?:18|19|20)\d{2}/);
 const subtitle=String(book?.subtitle||"").trim();
 const sourceUrl=typeof book?.link==="string"&&/^https:\/\/www\.isbnlab\.com\//i.test(book.link)?book.link:null;
 const identifiers=isbns.map(value=>({type:"isbn",value,normalized:value}));
 return {
  title:metadataTitleClean(book?.title||""),
  authors,
  isbns,
  identifiers,
  publisher:publishers[0]||imprint[0]||"",
  year:date?Number(date[0]):null,
  description:metadataCleanDescription([subtitle?("Subtítulo: "+subtitle):"",book?.description||""].filter(Boolean).join("\n\n")),
  tags:[...new Set([...subjects,...genres])].slice(0,40),
  pageCount:Number(book?.numberOfPages)||null,
  source:"ISBNLab",
  printType:"BOOK",
  documentKind:"book",
  sourceId:book?.id!==undefined?String(book.id):queriedIsbn,
  sourceUrl
 };
}

const isbnLabResultCache=new Map();
let isbnLabRequestChain=Promise.resolve(),isbnLabLastRequest=0,isbnLabBackoffUntil=0,isbnLabPausedUntil=0,isbnLabPausedReason="";
async function isbnLabSearch(value) {
 const isbn=metadataValidIsbn(value);
 if(!isbn)return[];
 if(isbnLabResultCache.has(isbn))return isbnLabResultCache.get(isbn);
 if(Date.now()<isbnLabPausedUntil)throw new Error(isbnLabPausedReason||"ISBNLab temporalmente pausado.");
 const request=isbnLabRequestChain.then(async()=>{
  if(isbnLabResultCache.has(isbn))return isbnLabResultCache.get(isbn);
  if(Date.now()<isbnLabPausedUntil)throw new Error(isbnLabPausedReason||"ISBNLab temporalmente pausado.");
  if(Date.now()<isbnLabBackoffUntil)throw new Error("ISBNLab límite temporal; reintentar en "+Math.ceil((isbnLabBackoffUntil-Date.now())/1000)+" s");
  const wait=Math.max(0,1000-(Date.now()-isbnLabLastRequest));
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  isbnLabLastRequest=Date.now();
  const base=(c.pdfGatewayUrl||"").replace(/\/+$/,"");
  if(!base)throw new Error("Falta configurar el gateway de ISBNLab.");
  const {data:{session}}=await db.auth.getSession();
  if(!session?.access_token)throw new Error("Sesión vencida.");
  const endpoint=new URL(base+"/catalog/isbnlab");
  endpoint.searchParams.set("isbn",isbn);
  const response=await fetch(endpoint,{headers:{Authorization:"Bearer "+session.access_token},signal:AbortSignal.timeout(16000)});
  let payload={};try{payload=await response.json()}catch{}
  if(response.status===404||payload.notFound){isbnLabResultCache.set(isbn,[]);return[];}
  if(response.status===429){
   const seconds=Math.max(1,Number(payload.retryAfterSeconds)||1);
   isbnLabBackoffUntil=Date.now()+seconds*1000;
   throw new Error("ISBNLab HTTP 429 · reintentar en "+seconds+" s");
  }
  if(!response.ok){
   const detail=payload.error||("ISBNLab gateway HTTP "+response.status);
   if(payload.code==="isbnlab_not_configured"||payload.code==="isbnlab_auth_error"){
    isbnLabPausedReason=detail;
    isbnLabPausedUntil=Date.now()+10*60*1000;
   }
   throw new Error(detail+(payload.detail?": "+payload.detail:""));
  }
  if(!payload.match||!payload.book){isbnLabResultCache.set(isbn,[]);return[];}
  const candidates=[metadataCandidateFromIsbnLab(payload.book,isbn)];
  isbnLabResultCache.set(isbn,candidates);
  return candidates;
 });
 isbnLabRequestChain=request.catch(()=>null);
 return request;
}

const googleBooksCache=new Map();
let googleBooksRequestChain=Promise.resolve(),googleBooksLastRequest=0,googleBooksBackoffUntil=0;
async function googleBooksSearch(context){
 const isbn=metadataValidIsbn(context.isbn||"");
 const title=String(context.title||"").trim();
 const author=String(context.authors?.[0]||"").trim();
 if(!isbn&&!title)return[];
 const cacheKey=isbn?"isbn:"+isbn:"title:"+metadataTextKey(title)+"|author:"+metadataTextKey(author);
 if(googleBooksCache.has(cacheKey))return googleBooksCache.get(cacheKey);
 const request=googleBooksRequestChain.then(async()=>{
  if(googleBooksCache.has(cacheKey))return googleBooksCache.get(cacheKey);
  if(Date.now()<googleBooksBackoffUntil)throw new Error("Google Books en pausa por cuota; reintentar en "+Math.ceil((googleBooksBackoffUntil-Date.now())/1000)+" s");
  const wait=Math.max(0,1000-(Date.now()-googleBooksLastRequest));
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  googleBooksLastRequest=Date.now();
  const base=(c.pdfGatewayUrl||"").replace(/\/+$/,"");
  if(!base)throw new Error("Falta configurar el gateway de Google Books.");
  const {data:{session}}=await db.auth.getSession();
  if(!session?.access_token)throw new Error("Sesión vencida.");
  const endpoint=new URL(base+"/catalog/google-books");
  if(isbn)endpoint.searchParams.set("isbn",isbn);
  else{
   endpoint.searchParams.set("title",title.slice(0,180));
   if(author)endpoint.searchParams.set("author",author.slice(0,120));
  }
  const response=await fetch(endpoint,{headers:{Authorization:"Bearer "+session.access_token},signal:AbortSignal.timeout(16000)});
  let payload={};try{payload=await response.json()}catch{}
  if(response.status===429){
   const seconds=Math.max(1,Number(payload.retryAfterSeconds)||60);
   googleBooksBackoffUntil=Date.now()+seconds*1000;
   throw new Error("Google Books HTTP 429 · "+(payload.error||"cuota excedida")+" · reintentar en "+seconds+" s");
  }
  if(!response.ok)throw new Error(payload.error||("Google Books gateway HTTP "+response.status));
  const candidates=(payload.items||[]).map(metadataCandidateFromGoogle).filter(x=>metadataTitleUsable(x.title));
  googleBooksCache.set(cacheKey,candidates);
  return candidates;
 });
 googleBooksRequestChain=request.catch(()=>null);
 return request;
}

async function openLibrarySearch(context){
 const p=new URLSearchParams({fields:'key,title,author_name,first_publish_year,isbn,publisher,subject,number_of_pages_median',limit:'10'});
 if(context.isbn)p.set('isbn',context.isbn);else{p.set('title',context.title);if(context.authors?.[0])p.set('author',context.authors[0])}
 const r=await openLibraryFetch('https://openlibrary.org/search.json?'+p);if(!r.ok)throw new Error('Open Library HTTP '+r.status);const data=await r.json();
 return(data.docs||[]).map(x=>{const isbns=(x.isbn||[]).map(metadataValidIsbn).filter(Boolean);return{title:metadataTitleClean(x.title||''),authors:(x.author_name||[]).map(metadataAuthorClean).filter(metadataAuthorUsable),isbns,publisher:(x.publisher||[])[0]||'',year:Number(x.first_publish_year)||null,description:'',tags:(x.subject||[]).slice(0,30),pageCount:x.number_of_pages_median||null,source:'Open Library',printType:'BOOK',sourceId:x.key||null,identifiers:isbns.map(value=>({type:'isbn',value,normalized:value}))}}).filter(x=>metadataTitleUsable(x.title));
}

async function openLibraryLookupOclc(identifier){
 if(identifier?.type!=='oclc')return[];
 const number=String(identifier.value||'').replace(/\D/g,'');
 if(!/^\d{5,12}$/.test(number))return[];
 const bibkey='OCLC:'+number;
 const params=new URLSearchParams({bibkeys:bibkey,format:'json',jscmd:'data'});
 const response=await openLibraryFetch('https://openlibrary.org/api/books?'+params);
 if(!response.ok)throw new Error('Open Library OCLC HTTP '+response.status);
 const payload=await response.json(),record=payload?.[bibkey];
 if(!record||!metadataTitleUsable(record.title))return[];
 const rawIds=record.identifiers||{};
 const isbns=[...(rawIds.isbn_10||[]),...(rawIds.isbn_13||[]),...(rawIds.isbn||[])].map(metadataValidIsbn).filter(Boolean);
 const authors=(record.authors||[]).map(x=>metadataAuthorClean(x?.name||x)).filter(metadataAuthorUsable);
 const publishers=record.publishers||[];
 const publisher=publishers.length?String(publishers[0]?.name||publishers[0]||''):'';
 const date=String(record.publish_date||'').match(/(?:18|19|20)\d{2}/);
 const subjects=(record.subjects||[]).map(x=>String(x?.name||x||'')).filter(Boolean).slice(0,30);
 return[{
  title:metadataTitleClean(record.title),authors,isbns:[...new Set(isbns)],
  identifiers:[identifier,...[...new Set(isbns)].map(value=>({type:'isbn',value,normalized:value}))],
  publisher,year:date?Number(date[0]):null,description:'',tags:subjects,
  pageCount:Number(record.number_of_pages)||null,source:'Open Library · OCLC',
  printType:'BOOK',sourceId:record.url||bibkey,sourceUrl:record.url||null
 }];
}

async function crossrefLookupIdentifier(identifier){
 const type=identifier?.type,value=String(identifier?.value||'');
 if(type!=='doi'&&type!=='issn')return[];
 const url=type==='doi'?'https://api.crossref.org/works/'+encodeURIComponent(metadataNormalizeDoi(value)):'https://api.crossref.org/journals/'+encodeURIComponent(value.replace(/[^0-9Xx]/g,''));
 const response=await fetch(url,{signal:AbortSignal.timeout(9000)});
 if(!response.ok)throw new Error('Crossref HTTP '+response.status);
 const payload=await response.json(),m=payload?.message;if(!m)return[];
 if(type==='issn'){
  const title=metadataTitleClean(m.title||'');if(!metadataTitleUsable(title))return[];
  return[{title,authors:[],isbns:[],identifiers:[{type:'issn',value,normalized:metadataNormalizeIdentifier('issn',value)}],publisher:String(m.publisher||''),year:null,description:'',tags:['Publicaciones periódicas'],pageCount:null,source:'Crossref · ISSN',printType:'JOURNAL',documentKind:'periodical',sourceId:value}];
 }
 const title=metadataTitleClean((m.title||[])[0]||'');if(!metadataTitleUsable(title))return[];
 const authors=(m.author||[]).map(a=>[a.given,a.family].filter(Boolean).join(' ')).filter(metadataAuthorUsable);
 const date=m['published-print']?.['date-parts']?.[0]||m['published-online']?.['date-parts']?.[0]||m.created?.['date-parts']?.[0]||[];
 const identifiers=[{type:'doi',value,normalized:metadataNormalizeDoi(value)},...(m.ISSN||[]).map(x=>({type:'issn',value:x,normalized:metadataNormalizeIdentifier('issn',x)}))];
 return[{title,authors,isbns:(m.ISBN||[]).map(metadataValidIsbn).filter(Boolean),identifiers,publisher:String(m.publisher||''),year:Number(date[0])||null,description:metadataCleanDescription(m.abstract||''),tags:(m.subject||[]).slice(0,30),pageCount:null,source:'Crossref · DOI',printType:String(m.type||'').toUpperCase(),documentKind:m.type==='journal-article'?'article':m.type==='book'?'book':'unknown',sourceId:m.DOI||value}];
}
async function locLookupIdentifier(identifier){
 if(identifier?.type!=='ismn')return[];
 const url='https://www.loc.gov/search/?q='+encodeURIComponent('"'+identifier.value+'"')+'&fo=json&c=8';
 const response=await fetch(url,{signal:AbortSignal.timeout(9000)});if(!response.ok)throw new Error('Library of Congress HTTP '+response.status);
 const data=await response.json(),results=data.results||[],needle=String(identifier.normalized||identifier.value).replace(/[^0-9A-Z]/gi,'').toUpperCase();
 return results.filter(item=>JSON.stringify(item).replace(/[^0-9A-Z]/gi,'').toUpperCase().includes(needle)).map(item=>{
  const title=metadataTitleClean(item.title||'');
  const contributor=Array.isArray(item.contributor)?item.contributor:[item.contributor].filter(Boolean);
  const year=(String(item.date||'').match(/(?:18|19|20)\d{2}/)||[])[0];
  return{title,authors:contributor.map(metadataAuthorClean).filter(metadataAuthorUsable),isbns:[],identifiers:[identifier],publisher:String(item.publisher||''),year:Number(year)||null,description:metadataCleanDescription(item.description||''),tags:(item.subject||[]).flatMap(x=>String(x).split(/[;|]/)).map(x=>x.trim()).filter(Boolean),pageCount:null,source:'Library of Congress · ISMN',printType:'MUSIC',documentKind:'music_score',sourceId:item.id||item.url||null};
 }).filter(x=>metadataTitleUsable(x.title));
}
function metadataRismItemUrl(item){
 const raw=item?.['@id']||item?.id||item?.url||item?.uri||item?.resource||item?.href;
 const value=typeof raw==='object'?(raw?.['@id']||raw?.uri||raw?.url||raw?.id):raw;
 if(!value)return null;
 if(/^\d+$/.test(String(value)))return 'https://rism.online/sources/'+String(value);
 try{const url=new URL(String(value),'https://rism.online');return url.origin==='https://rism.online'&&/^\/sources\/\d+\/?$/.test(url.pathname)?url.href:null}catch{return null}
}
function metadataRismSearchItems(payload){
 const values=payload?.items||payload?.['@graph']||payload?.itemListElement||payload?.['hydra:member']||[];
 return Array.isArray(values)?values.map(x=>x?.item||x?.result||x).filter(x=>x&&typeof x==='object'):[];
}
function metadataRismFields(xml,tag,code='a'){
 return Array.from(xml.getElementsByTagNameNS('*','datafield')).filter(x=>x.getAttribute('tag')===tag)
  .flatMap(field=>Array.from(field.getElementsByTagNameNS('*','subfield')).filter(x=>x.getAttribute('code')===code)
  .map(x=>String(x.textContent||'').trim()).filter(Boolean));
}
async function rismLookupPublisherNumber(identifier,contexts=[]){
 if(identifier?.type!=='publisher_number'||!identifier.value)return[];
 const expected=metadataNormalizeIdentifier('publisher_number',identifier.value),compact=expected.replace(/[^0-9A-Z]/g,'');
 const codeQueries=[String(identifier.value).trim(),compact];
 const titleQueries=(contexts||[]).slice(0,2).map(context=>[context.title,context.authors?.[0]].filter(Boolean).join(' '));
 const queries=[...new Set([...codeQueries,...titleQueries])].filter(Boolean);
 const seen=new Set(),candidates=[];
 for(const query of queries){
  const params=new URLSearchParams({mode:'sources',q:query,rows:'20'});
  const response=await fetch('https://rism.online/search?'+params,{headers:{Accept:'application/ld+json'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('RISM Online HTTP '+response.status);
  const payload=await response.json(),items=metadataRismSearchItems(payload);
  for(const item of items.slice(0,12)){
   const sourceUrl=metadataRismItemUrl(item);if(!sourceUrl||seen.has(sourceUrl))continue;seen.add(sourceUrl);
   let recordResponse;
   try{recordResponse=await fetch(sourceUrl,{headers:{Accept:'application/marcxml+xml'},signal:AbortSignal.timeout(8000)})}
   catch(error){console.info('RISM MARC record unavailable:',error?.message||error);continue}
   if(!recordResponse.ok)continue;
   const xml=new DOMParser().parseFromString(await recordResponse.text(),'application/xml');
   if(xml.querySelector('parsererror'))continue;
   const publisherNumbers=metadataRismFields(xml,'028','a');
   const exactMatch=publisherNumbers.some(value=>{const normalized=metadataNormalizeIdentifier('publisher_number',value);return normalized===expected||normalized.replace(/[^0-9A-Z]/g,'')===compact});
   if(!exactMatch)continue;
   const title=metadataTitleClean([...metadataRismFields(xml,'245','a'),...metadataRismFields(xml,'245','b')].join(' '));
   if(!metadataTitleUsable(title))continue;
   const authorValues=[100,110,700,710].flatMap(tag=>metadataRismFields(xml,String(tag),'a'));
   const authors=[...new Set(authorValues.map(metadataAuthorClean).filter(metadataAuthorUsable))].slice(0,10);
   const publisher=[...metadataRismFields(xml,'264','b'),...metadataRismFields(xml,'260','b')].find(Boolean)||'';
   const date=[...metadataRismFields(xml,'264','c'),...metadataRismFields(xml,'260','c')].join(' ');
   const year=Number((date.match(/(?:18|19|20)\d{2}/)||[])[0])||null;
   const isbns=[...new Set(metadataRismFields(xml,'020','a').map(metadataValidIsbn).filter(Boolean))];
   const field024=Array.from(xml.getElementsByTagNameNS('*','datafield')).filter(x=>x.getAttribute('tag')==='024');
   const ismns=[...new Set(field024.filter(field=>field.getAttribute('ind1')==='2').flatMap(field=>
    Array.from(field.getElementsByTagNameNS('*','subfield')).filter(x=>x.getAttribute('code')==='a')
     .map(x=>metadataValidIsmn(x.textContent||'')).filter(Boolean)))];
   const identifiers=[
    {type:'publisher_number',value:identifier.value,normalized:expected,source:'RISM Online · MARC 028',pages:[],occurrences:1,confidence:100,sourceRecord:sourceUrl},
    ...isbns.map(value=>({type:'isbn',value,normalized:value,source:'RISM Online · MARC 020',pages:[],occurrences:1,confidence:100,sourceRecord:sourceUrl})),
    ...ismns.map(value=>({type:'ismn',value,normalized:metadataNormalizeIdentifier('ismn',value),source:'RISM Online · MARC 024',pages:[],occurrences:1,confidence:100,sourceRecord:sourceUrl}))
   ];
   candidates.push({title,authors,isbns,identifiers,publisher,year,description:'Registro musical de RISM Online. Número editorial verificado en el campo MARC 028.',
    tags:['Música','Partituras'],pageCount:null,source:'RISM Online · número editorial (MARC 028)',
    sourceId:sourceUrl.split('/').filter(Boolean).pop(),sourceUrl,publisherNumber:identifier.value,printType:'MUSIC',documentKind:'music_score'});
  }
  if(candidates.length)break;
 }
 return candidates;
}
async function imslpLookupPublisherNumber(identifier,contexts=[]){
 if(identifier?.type!=='publisher_number'||!/^BA\s*\d/i.test(identifier.value))return[];
 const code=String(identifier.value).trim(),needle=String(identifier.normalized||identifier.value).replace(/[^0-9A-Z]/gi,'').toUpperCase();
 const queries=[code,...(contexts||[]).slice(0,2).map(x=>[x.title,code].filter(Boolean).join(' '))];
 const results=[],seen=new Set();
 for(const query of queries){
  const params=new URLSearchParams({action:'query',list:'search',srsearch:query,srnamespace:'0',srlimit:'8',format:'json',origin:'*'});
  const response=await fetch('https://imslp.org/api.php?'+params,{signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw new Error('IMSLP HTTP '+response.status);
  const data=await response.json();
  for(const item of data?.query?.search||[])if(!seen.has(item.title)){seen.add(item.title);results.push(item)}
 }
 return results.filter(x=>(String(x.title||'')+' '+String(x.snippet||'')).replace(/<[^>]*>/g,'').replace(/[^0-9A-Z]/gi,'').toUpperCase().includes(needle)).map(item=>{
  const raw=String(item.title||'').replace(/_/g,' '),m=raw.match(/^(.+?)\s*\(([^()]*)\)$/),title=metadataTitleClean(m?m[1]:raw),authorRaw=m?m[2].replace(/,/g,' '):'';
  return{title,authors:authorRaw?[metadataAuthorClean(authorRaw)]:[],isbns:[],identifiers:[identifier],publisher:'',year:null,description:metadataCleanDescription(String(item.snippet||'').replace(/<[^>]*>/g,' ')),tags:['Música','Partituras'],pageCount:null,source:'IMSLP · número editorial',printType:'MUSIC',documentKind:'music_score',sourceId:item.title};
 }).filter(x=>metadataTitleUsable(x.title));
}
function metadataMelosPersonNames(value){
 const generic=/^(?:autores? varios|varios autores|various authors|multiple authors|an[oó]nimos?|unknown)$/i;
 const entries=(Array.isArray(value)?value:[value]).flatMap(item=>
  String(item||'').split(/[\/;|\n]+/).map(part=>part.trim()).filter(Boolean)
 );
 const output=[],seen=new Set();
 for(let entry of entries){
  entry=entry
   .replace(/\s+(?:(?:y|e)\s+otros?|and\s+others?|et\s+al\.?)\s*$/i,'')
   .replace(/^[\s,;|]+|[\s,;|]+$/g,'')
   .replace(/\s+/g,' ')
   .trim();
  if(!entry||generic.test(metadataTextKey(entry))||entry.length>160)continue;
  const key=metadataTextKey(entry);
  if(seen.has(key))continue;
  seen.add(key);
  output.push(entry);
 }
 return output;
}
function metadataMelosAuthorList(product){
 const namedAuthors=metadataMelosPersonNames(product?.author||'');
 if(namedAuthors.length)return namedAuthors;
 return metadataMelosPersonNames(product?.collaborators||[]);
}

async function melosLookupPublisherNumber(identifier,trace=[]){
 if(identifier?.type!=='publisher_number'||!/^(?:BA|MEL)\s*[-.]?\s*\d{3,8}$/i.test(identifier.value||''))return[];
 const base=(c.pdfGatewayUrl||'').replace(/\/+$/,'');
 if(!base)throw new Error('Falta configurar el gateway de catálogo.');
 const {data:{session}}=await db.auth.getSession();
 if(!session?.access_token)throw new Error('Sesión vencida.');
 const endpoint=new URL(base+'/catalog/melos');
 endpoint.searchParams.set('code',String(identifier.value).replace(/[^A-Z0-9]/gi,'').toUpperCase());
 const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+session.access_token}});
 let payload={};try{payload=await response.json()}catch{}
 if(!response.ok)throw new Error(payload.error||('Gateway Melos HTTP '+response.status)+(payload.detail?': '+payload.detail:''));
 if(!payload.match||!payload.product){
  trace.push({source:'Melos · catálogo oficial',identifier:identifier.value,results:0,note:'Sin producto con Cod exacto'+(payload.productCandidates!==undefined?' · '+payload.productCandidates+' candidatos examinados':''),url:payload.query||null});
  return[];
 }
 const product=payload.product,normalized=metadataNormalizeIdentifier('publisher_number',identifier.value);
 if(metadataNormalizeIdentifier('publisher_number',product.code)!==normalized){
  trace.push({source:'Melos · catálogo oficial',identifier:identifier.value,results:0,note:'El Cod de la ficha no coincide exactamente.'});
  return[];
 }
 const barcode=String(product.barcode||'').trim(),barcodeIsmn=metadataValidIsmn(barcode),barcodeIsbn=metadataValidIsbn(barcode);
 const identifiers=[
  {...identifier,value:product.code,normalized,source:'Melos · Cod verificado',sourceRecord:product.url,pages:identifier.pages||[],occurrences:identifier.occurrences||0,confidence:100}
 ];
 if(barcodeIsmn)identifiers.push({type:'ismn',value:barcodeIsmn,normalized:metadataNormalizeIdentifier('ismn',barcodeIsmn),source:'Melos · código de barras',sourceRecord:product.url,pages:[],occurrences:1,confidence:100});
 else if(barcodeIsbn)identifiers.push({type:'isbn',value:barcodeIsbn,normalized:barcodeIsbn,source:'Melos · código de barras',sourceRecord:product.url,pages:[],occurrences:1,confidence:100});
 const tags=[...(Array.isArray(product.tags)?product.tags:[])].filter(Boolean);
 if(product.instrument)tags.unshift(product.instrument);
 if(!tags.some(x=>metadataTextKey(x)==='partituras'))tags.unshift('Partituras');
 if(!tags.some(x=>metadataTextKey(x)==='musica'))tags.unshift('Música');
 // Prefer explicit names from "Autor/Marca". When that field is generic
 // ("Autores varios"), use the official "Colaboradores" names for author indexing.
 const authors=metadataMelosAuthorList(product);
 const catalogDetails={
  ...product,
  source:'Ediciones Melos · ficha oficial',
  verifiedCode:product.code,
  barcodeType:barcodeIsmn?'ISMN':barcodeIsbn?'ISBN':'Código de barras sin clasificar'
 };
 trace.push({source:'Melos · catálogo oficial',identifier:identifier.value,results:1,note:'Cod exacto verificado · '+(identifiers.length>1?'identificador normalizado recuperado':'ficha localizada'),url:product.url});
 return [{
  title:metadataTitleClean(product.title||''),
  authors,
  isbns:barcodeIsbn?[barcodeIsbn]:[],
  identifiers,
  publisher:product.publisher||'Ediciones Melos',
  year:null,
  description:'',
  tags:[...new Set(tags)],
  pageCount:null,
  source:'Ediciones Melos · catálogo oficial',
  sourceId:product.url,
  sourceUrl:product.url,
  printType:'MUSIC',
  documentKind:'music_score',
  catalogDetails
 }].filter(x=>metadataTitleUsable(x.title));
}

async function lookupBibliographicCandidate(contexts,identifiers=[],documentKind='unknown',trace=[]){
 let best=null;
 const seenIsbnLookups=new Set();
 const scoreCandidates=(candidates,context)=>{
  const ranked=(candidates||[]).map(x=>metadataRankCandidate(x,{...context,identifiers})).sort((a,b)=>b.score-a.score);
  if(ranked[0]&&(!best||ranked[0].score>best.score))best=ranked[0];
 };
 const addTrace=(source,identifier,candidates,error=null,details={})=>trace.push({source,identifier:identifier?.value||'',results:(candidates||[]).length,error:error?String(error?.message||error).slice(0,240):null,...details});
 for(const identifier of identifiers){
  if(identifier.type==='publisher_number'){
   let candidates=[];
   if(/^(?:BA|MEL)\s*[-.]?\s*\d{3,8}$/i.test(identifier.value||'')){
    try{candidates=await melosLookupPublisherNumber(identifier,trace)}
    catch(error){addTrace('Melos · catálogo oficial',identifier,[],error);console.info('Melos lookup unavailable:',error?.message||error)}
   }
   if(!candidates.length){
    try{candidates=await rismLookupPublisherNumber(identifier,contexts);addTrace('RISM Online',identifier,candidates)}
    catch(error){addTrace('RISM Online',identifier,[],error);console.info('RISM publisher-number lookup unavailable:',error?.message||error)}
   }
   if(!candidates.length){
    try{candidates=await imslpLookupPublisherNumber(identifier,contexts);addTrace('IMSLP',identifier,candidates)}
    catch(error){addTrace('IMSLP',identifier,[],error);console.info('IMSLP publisher-number lookup unavailable:',error?.message||error)}
   }
   for(const context of contexts.length?contexts:[{title:'',authors:[]}])scoreCandidates(candidates,context);
  }else if(identifier.type==='isbn'){
   const isbn=metadataValidIsbn(identifier.value);
   if(isbn&&!seenIsbnLookups.has(isbn)){
    seenIsbnLookups.add(isbn);
    const contextsForIsbn=contexts.length?contexts:[{title:'',authors:[]}];
    try{
     const candidates=await isbnLabSearch(isbn);
     addTrace('ISBNLab · ISBN',identifier,candidates,null,candidates.length?{}:{note:'ISBN no encontrado en ISBNLab'});
     for(const context of contextsForIsbn)scoreCandidates(candidates,{...context,isbn});
    }catch(error){addTrace('ISBNLab · ISBN',identifier,[],error);console.info('ISBNLab ISBN lookup unavailable:',error?.message||error)}
    if(best&&metadataCandidateAccepted(best))return best;
    try{
     const candidates=await googleBooksSearch({isbn});
     addTrace('Google Books · ISBN',identifier,candidates);
     for(const context of contextsForIsbn)scoreCandidates(candidates,{...context,isbn});
    }catch(error){addTrace('Google Books · ISBN',identifier,[],error);console.info('Google Books ISBN lookup unavailable:',error?.message||error)}
    try{
     const candidates=await openLibrarySearch({isbn});
     addTrace('Open Library · ISBN',identifier,candidates);
     for(const context of contextsForIsbn)scoreCandidates(candidates,{...context,isbn});
    }catch(error){addTrace('Open Library · ISBN',identifier,[],error);console.info('Open Library ISBN lookup unavailable:',error?.message||error)}
   }
  }else{
   try{
    let candidates=[];
    if(identifier.type==='doi'||identifier.type==='issn')candidates=await crossrefLookupIdentifier(identifier);
    else if(identifier.type==='ismn')candidates=await locLookupIdentifier(identifier);
    else if(identifier.type==='oclc')candidates=await openLibraryLookupOclc(identifier);
    addTrace(identifier.type==='doi'||identifier.type==='issn'?'Crossref':identifier.type==='ismn'?'Library of Congress':identifier.type==='oclc'?'Open Library · OCLC':'Identifier catalog',identifier,candidates);
    for(const context of contexts.length?contexts:[{title:'',authors:[]}])scoreCandidates(candidates,context);
   }catch(error){addTrace('Identifier lookup',identifier,[],error);console.info('Identifier lookup unavailable ('+identifier.type+'):',error?.message||error)}
  }
  if(best&&metadataCandidateAccepted(best))return best;
 }
 if(['music_score','periodical','article'].includes(documentKind))return best;
 for(const context of contexts){
  if(!context.title&&!context.isbn)continue;
  try{scoreCandidates(await googleBooksSearch(context),context);if(best&&metadataCandidateAccepted(best))return best}catch(e){console.info('Google Books lookup unavailable:',e?.message||e)}
 }
 for(const context of contexts){
  if(!context.title&&!context.isbn)continue;
  try{scoreCandidates(await openLibrarySearch(context),context);if(best&&metadataCandidateAccepted(best))return best}catch(e){console.info('Open Library lookup unavailable:',e?.message||e)}
 }
 return best;
}
function metadataDetectDocumentKind(filename,text,catalogMatch,identifiers=[]){
 const s=metadataTextKey(String(filename||'')+' '+String(text||'').slice(0,16000));
 const types=new Set((identifiers||[]).map(x=>x.type));
 if(types.has('ismn')||types.has('publisher_number'))return'music_score';
 if(types.has('issn'))return'periodical';
 if(types.has('doi')&&/\b(abstract|journal|article|articulo|research paper|preprint)\b/.test(s))return'article';
 if(/\b(factura|invoice|recibo|presupuesto|contrato|curriculum|curriculum vitae|diapositivas|presentacion|formulario|certificado|extracto bancario|orden de compra)\b/.test(s))return'other';
 if(/\b(revista|magazine|journal|boletin|newsletter|periodical|issn)\b/.test(s))return'periodical';
 if(/\b(tesis|dissertation|tesina|trabajo final|doctoral thesis)\b/.test(s))return'academic';
 if(/\b(articulo|article|research paper|preprint|doi 10)\b/.test(s))return'article';
 if(/\b(partitura|sheet music|score|songbook|cancionero|coros mixtos|coro|piano|pianoforte|guitarra|guitarras|guitar|violin|viola|violoncello|violonchelo|flauta|flute|organ|organo|clarinete|clarinet|saxofon|saxophone|malambo|zamba|vidalita|chacarera|milonga|gymnopedie|claire de lune|clair de lune|nocturne|nocturno|preludio|prelude|sonata|suite|etude|estudio musical|vals|waltz|mazurka|polonaise)\b/.test(s))return'music_score';
 if(/\b(manual de usuario|user manual|instrucciones de uso|reglamento|guia de usuario)\b/.test(s))return'manual';
 if(/\b(diccionario|enciclopedia|atlas|catalogo)\b/.test(s))return'reference';
 if(catalogMatch&&catalogMatch.score>=92&&catalogMatch.printType==='BOOK')return'book';
 return'unknown';
}
function metadataBuildTags({filename='',text='',kind='unknown',catalog=null,accepted=false,embeddedTags=[],publisher='',identifiers=[]}){
 const out=[],seen=new Set(),add=value=>{
  const tag=String(value||'').replace(/\s+/g,' ').trim(),key=metadataTextKey(tag);
  if(!tag||!key||seen.has(key)||tag.length>60)return;
  seen.add(key);out.push(tag);
 };
 if(accepted&&catalog)for(const tag of catalog.tags||[])add(tag);
 for(const tag of embeddedTags||[])add(tag);
 if(kind==='music_score'){add('Música');add('Partituras')}
 if(kind==='periodical')add('Publicaciones periódicas');
 if(kind==='article')add('Artículos');
 if(kind==='academic')add('Trabajos académicos');
 if(kind==='manual')add('Manuales y guías');
 if(kind==='reference')add('Obras de referencia');
 const s=metadataTextKey([filename,text.slice(0,18000),(catalog?.tags||[]).join(' ')].join(' '));
 const instruments=[
  [/\b(piano|pianoforte)\b/,'Piano'],
  [/\b(guitarra|guitarras|guitar|guitars)\b/,'Guitarra'],
  [/\b(violin|viola|violoncello|violonchelo|cello)\b/,'Cuerdas'],
  [/\b(flauta|flute|piccolo)\b/,'Vientos · flauta'],
  [/\b(clarinete|clarinet|oboe|fagot|bassoon)\b/,'Vientos · maderas'],
  [/\b(trompeta|trumpet|trombon|trombone|corno|horn)\b/,'Vientos · metales'],
  [/\b(organ|organo)\b/,'Órgano'],
  [/\b(voz|vocal|canto|soprano|alto|tenor|baritono|bajo|coral|coro|coros)\b/,'Voz y coro']
 ];
 if(kind==='music_score')for(const [re,tag] of instruments)if(re.test(s))add(tag);
 const genres=[
  [/\b(jazz|bebop|swing|ragtime)\b/,'Jazz'],
  [/\b(tango|milonga)\b/,'Tango'],
  [/\b(zamba|malambo|vidalita|chacarera|folklore|folclore|gato|cueca)\b/,'Folklore argentino'],
  [/\b(baroque|barroco)\b/,'Barroco'],
  [/\b(classical|clasica|clasico|musica clasica)\b/,'Música clásica'],
  [/\b(romantic|romantico|romantica)\b/,'Romanticismo'],
  [/\b(blues)\b/,'Blues']
 ];
 for(const [re,tag] of genres)if(re.test(s))add(tag);
 if(/barenreiter/.test(metadataTextKey(publisher)))add('Bärenreiter');
 return out.slice(0,24);
}
function metadataCategoryFromTags(tags,kind){
 const s=metadataTextKey((tags||[]).join(' '));
 if(kind==='music_score'){
  if(s.includes('guitarra'))return'Partituras para guitarra';
  if(s.includes('piano'))return'Partituras para piano';
  if(s.includes('voz y coro')||s.includes('coro'))return'Partituras corales';
  return'Partituras';
 }
 if(s.includes('guitarra')||s.includes('guitar'))return'Partituras para guitarra';
 if(s.includes('piano'))return'Música para piano';
 if(s.includes('jazz'))return'Jazz';
 if(s.includes('musica')||s.includes('music'))return'Música';
 if(kind==='academic')return'Trabajos académicos';
 if(kind==='article')return'Artículos';
 if(kind==='periodical')return'Publicaciones periódicas';
 if(kind==='manual')return'Manuales y guías';
 if(kind==='reference')return'Obras de referencia';
 return'General';
}
function metadataKindLabel(kind){return({book:'Libro',academic:'Tesis / trabajo académico',article:'Artículo',music_score:'Partitura / cancionero',periodical:'Revista / publicación periódica',manual:'Manual / guía',reference:'Obra de referencia',other:'Otro tipo de documento',unknown:'Sin clasificar'})[kind]||'Sin clasificar'}
function metadataMatchLabel(status,confidence){const score=confidence===null||confidence===undefined?'':(' · '+confidence+'%');return({matched:'Catálogo coincidente'+score,review:'Coincidencia para confirmar'+score,unmatched:'Sin coincidencia',non_book:'Posible documento no bibliográfico',duplicate:'Posible duplicado'+score})[status]||'Sin revisar'}
function metadataSourceLabel(source){return({filename:'Nombre del archivo',embedded:'Metadatos internos del PDF',pdf_text:'Texto extraído del PDF',manual:'Revisión manual'})[source]||'Sin especificar'}
async function analyzeStoredDocument(id,showToast=true,tokenOverride=null,additionalCandidates=[]){
 let d=books.find(x=>x.id===id)||pendingDocs.find(x=>x.id===id);
 if(!d){
  const{data:row,error}=await db.from('documents').select('id,title,authors,publication_year,category,page_count,size_bytes,file_fingerprint,provider,description,tags,isbn,publisher,metadata_source,metadata_reviewed,metadata_status,metadata_error,upload_status,original_filename,metadata_match_status,metadata_confidence,metadata_candidate,document_kind,bibliographic_identifiers,metadata_evidence').eq('id',id).single();
  if(error||!row)throw error||new Error('Documento no encontrado.');
  d={...row,fileFingerprint:row.file_fingerprint||null,year:row.publication_year||'',authors:row.authors||[],tags:row.tags||[],metadataSource:row.metadata_source||'filename',metadataReviewed:!!row.metadata_reviewed,uploadStatus:row.upload_status||'stored',originalFilename:row.original_filename||'',bibliographicIdentifiers:row.bibliographic_identifiers||[],metadataEvidence:row.metadata_evidence||{}};
 }
 if(d.provider!=='r2')return{};
 if(d.uploadStatus&&d.uploadStatus!=='stored')throw new Error('El PDF todavía no está marcado como guardado en R2.');
 const{data:{session}}=await db.auth.getSession(),token=tokenOverride||session?.access_token;
 if(!token)throw new Error('Sesión vencida.');
 const originalFilename=String(d.originalFilename||d.original_filename||'').trim();
 const filename=metadataParseFilename(originalFilename||d.title||'');
 const existingIdentifiers=Array.isArray(d.bibliographicIdentifiers)?d.bibliographicIdentifiers:(Array.isArray(d.bibliographic_identifiers)?d.bibliographic_identifiers:[]);
 const fastKind=metadataDetectDocumentKind(originalFilename,'',null,existingIdentifiers);
 // Fast path only when the filename already contains enough bibliographic context.
 if(originalFilename&&metadataTitleIsSpecific(filename.title)&&!['music_score','periodical','article'].includes(fastKind)){
  const storedIsbn=metadataValidIsbn(d.isbn),fastContext={title:filename.title,authors:filename.authors,isbn:storedIsbn,publisher:d.publisher||'',year:d.year||d.publication_year||null,identifiers:existingIdentifiers};
  const fastCandidate=await lookupBibliographicCandidate([fastContext],existingIdentifiers,fastKind);
  if(metadataCandidateAccepted(fastCandidate)){
   const kind=metadataDetectDocumentKind(originalFilename,'',fastCandidate,existingIdentifiers),duplicateBase={id,title:fastCandidate.title,authors:fastCandidate.authors,isbn:storedIsbn||fastCandidate.isbns?.[0]||d.isbn,bibliographicIdentifiers:existingIdentifiers,fileFingerprint:d.fileFingerprint||d.file_fingerprint||null};
   const duplicates=[...books,...pendingDocs,...additionalCandidates].filter(other=>other&&other.id!==id&&bookDuplicateMatch(duplicateBase,[other]));
   const manual=d.metadataReviewed||d.metadata_reviewed||d.metadataSource==='manual'||d.metadata_source==='manual';
   const fastTags=metadataBuildTags({filename:originalFilename,kind,catalog:fastCandidate,accepted:true,embeddedTags:d.tags||[],publisher:fastCandidate.publisher,identifiers:existingIdentifiers});
   const fastUpdates={metadata_error:duplicates.length?'Posible coincidencia con "'+String(duplicates[0].title||'otro registro')+'". Verificá si son copias o ediciones distintas.':null,metadata_checked_at:new Date().toISOString(),metadata_match_status:duplicates.length?'duplicate':'matched',metadata_confidence:fastCandidate.score,metadata_candidate:null,document_kind:kind,metadata_status:'complete'};
   if(!manual){
    fastUpdates.title=fastCandidate.title.slice(0,300);
    if(fastCandidate.authors?.length)fastUpdates.authors=fastCandidate.authors.slice(0,20);
    if(storedIsbn||fastCandidate.isbns?.[0])fastUpdates.isbn=storedIsbn||fastCandidate.isbns[0];
    if(fastCandidate.publisher)fastUpdates.publisher=fastCandidate.publisher.slice(0,200);
    if(fastCandidate.year)fastUpdates.publication_year=fastCandidate.year;
    if(fastTags.length)fastUpdates.tags=fastTags;
    if(fastCandidate.description&&!d.description)fastUpdates.description=fastCandidate.description;
    fastUpdates.category=metadataCategoryFromTags(fastTags,kind);
    fastUpdates.metadata_source='filename';
    fastUpdates.metadata_reviewed=false;
   }
   const{error}=await db.from('documents').update(fastUpdates).eq('id',id);
   if(error)throw error;
   return{...fastUpdates,candidate:fastCandidate,accepted:true,fastPath:true,possibleDuplicates:duplicates};
  }
 }
 const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
 pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
 const url=(c.pdfGatewayUrl||'').replace(/\/+$/,'')+'/pdf/'+encodeURIComponent(id);
 const task=pdfjs.getDocument({url,httpHeaders:{Authorization:'Bearer '+token},withCredentials:false,disableAutoFetch:true,disableStream:true,rangeChunkSize:65536});
 try{
  const pdf=await task.promise,meta=await pdf.getMetadata(),info=meta?.info||{},pageLines=[],sampledPages=metadataSamplePages(pdf.numPages,18);
  for(const pageNumber of sampledPages){
   const page=await pdf.getPage(pageNumber),content=await page.getTextContent();
   pageLines.push(...metadataPageLines(content.items,pageNumber));
  }
  const text=pageLines.map(x=>x.text).join('\n');
  const normalized=[text,info.Subject||'',info.Keywords||''].join('\n').replace(/[\t\u00a0]+/g,' ').replace(/ {2,}/g,' ').replace(/\r/g,'\n');
  const firstPageLines=pageLines.filter(x=>x.page<=3);
  const titleLines=firstPageLines.filter(x=>metadataTitleUsable(x.text)&&metadataTitleIsSpecific(x.text)&&!metadataNameLike(x.text));
  const maxFont=Math.max(1,...titleLines.filter(x=>x.page<=2).map(x=>x.font));
  titleLines.sort((a,b)=>{
   const score=x=>(x.font/maxFont)*4+(x.page===1?2:x.page===2?1:0)-Math.max(0,x.text.length-80)/80;
   return score(b)-score(a);
  });
  const embeddedTitle=metadataTitleClean(info.Title||''),pageTitle=titleLines[0]?.text||'';
  const extractedTitle=metadataTitleIsSpecific(embeddedTitle)&&metadataTitleUsable(embeddedTitle)?embeddedTitle:pageTitle;
  const authorCandidates=[...(filename.authors||[])];
  const authorLabel=/^(?:autor(?:es)?|por|escrito por|written by|by|compositor(?:es)?|composer|composed by|m[uú]sica de|letra y m[uú]sica|lyrics(?: and music)? by|arr(?:eglo)?(?: de| by)?)\s*[:\-]?\s*(.{3,120})$/i;
  for(const line of firstPageLines){
   const match=line.text.match(authorLabel);
   if(match){const value=metadataAuthorClean(match[1]);if(metadataAuthorUsable(value))authorCandidates.push(value)}
   else if(metadataNameLike(line.text)&&metadataTextKey(line.text)!==metadataTextKey(extractedTitle)&&metadataTextKey(line.text)!==metadataTextKey(filename.title))authorCandidates.push(metadataAuthorClean(line.text));
  }
  const infoAuthor=String(info.Author||'').trim();
  if(infoAuthor&&!/[�]/.test(infoAuthor)&&infoAuthor.length<=120)authorCandidates.unshift(...infoAuthor.split(/[;,]/).map(metadataAuthorClean).filter(metadataAuthorUsable));
  const pdfAuthors=[...new Set(authorCandidates)].slice(0,10);
  const extractedIdentifiers=metadataExtractIdentifiers(normalized,pageLines);
  const identifiers=metadataUniqueIdentifiers([...existingIdentifiers.filter(x=>x.source==='manual'),...extractedIdentifiers]);
  const isbn=identifiers.find(x=>x.type==='isbn')?.value||metadataValidIsbn(d.isbn)||null;
  const pdfYear=metadataExtractYear(normalized);
  const publisherLine=pageLines.find(x=>/^(?:editorial|ediciones|publisher|published by)\b/i.test(x.text)&&!/(?:copyright|derechos reservados)/i.test(x.text));
  const repeatedLines=metadataExtractRepeatedLines(pageLines);
  const repeatedText=repeatedLines.map(x=>x.text).join(' ');
  const knownPublishers=[
   [/\bBärenreiter\b/i,'Bärenreiter'],[/\bUniversal Edition\b/i,'Universal Edition'],[/\bHenle Verlag\b/i,'G. Henle Verlag'],
   [/\bSchott\b/i,'Schott Music'],[/\bRicordi\b/i,'Ricordi'],[/\bDurand\b/i,'Durand'],[/\bPeters Edition\b/i,'Edition Peters'],
   [/\bBoosey\s*&?\s*Hawkes\b/i,'Boosey & Hawkes'],[/\bHal Leonard\b/i,'Hal Leonard']
  ];
  const knownPublisher=knownPublishers.find(([re])=>re.test(repeatedText+' '+normalized));
  const pdfPublisher=publisherLine
   ?publisherLine.text.replace(/^(?:editorial|ediciones|publisher|published by)\s*[:\-]?\s*/i,'').replace(/\s+(?:buenos aires|madrid|barcelona|argentina|españa)\b.*$/i,'').trim().slice(0,160)
   :(knownPublisher?.[1]||'');
  const embeddedTags=[...String(info.Keywords||'').split(/[,;|]/),...String(info.Subject||'').split(/[,;|]/)].map(x=>x.trim()).filter(x=>x.length>1&&x.length<80);
  const filenameTitle=metadataTitleIsSpecific(filename.title)&&metadataTitleUsable(filename.title)?filename.title:'';
  const fallbackTitle=metadataTitleIsSpecific(extractedTitle)&&metadataTitleUsable(extractedTitle)?extractedTitle:(metadataTitleIsSpecific(d.title)&&metadataTitleUsable(d.title)?metadataTitleClean(d.title):'');
  const primaryTitle=filenameTitle||fallbackTitle;
  const titles=[primaryTitle,extractedTitle].filter((x,i,a)=>x&&metadataTitleIsSpecific(x)&&a.findIndex(y=>metadataTextKey(y)===metadataTextKey(x))===i);
  const kind=metadataDetectDocumentKind(originalFilename||d.title,normalized,null,identifiers);
  const contexts=titles.map(title=>({title,authors:pdfAuthors,isbn,publisher:pdfPublisher,year:pdfYear,identifiers}));
  const lookupTrace=[];
  const external=await lookupBibliographicCandidate(contexts,identifiers,kind,lookupTrace);
  const accepted=metadataCandidateAccepted(external);
  const detectedPublisherId=identifiers.find(x=>x.type==='publisher_number');
  const exactMelosMatch=accepted&&external?.source==='Ediciones Melos · catálogo oficial'&&
   external.identifierMatch?.type==='publisher_number'&&
   metadataNormalizeIdentifier('publisher_number',external.catalogDetails?.verifiedCode||'')===
   metadataNormalizeIdentifier('publisher_number',detectedPublisherId?.value||'');
  const finalKind=kind==='unknown'&&accepted?(external.documentKind||(external.printType==='BOOK'?'book':'unknown')):kind;
  const proposedTitle=accepted?external.title:primaryTitle;
  // On an exact Melos code match, never fall back to PDF text for fields absent from the official record.
  const proposedAuthors=exactMelosMatch
   ?(String(external.catalogDetails?.author||'').trim()?[metadataAuthorClean(external.catalogDetails.author)]:[])
   :(accepted&&external.authors?.length?external.authors:pdfAuthors);
  const persistedIdentifiers=accepted
   ?metadataUniqueIdentifiers(exactMelosMatch?(external?.identifiers||[]):[...identifiers,...(external?.identifiers||[])])
   :identifiers;
  const duplicateBase={id,title:proposedTitle||d.title,authors:proposedAuthors,isbn:isbn||external?.isbns?.[0]||d.isbn,bibliographicIdentifiers:persistedIdentifiers,fileFingerprint:d.fileFingerprint||d.file_fingerprint||null};
  const possibleDuplicates=[...books,...pendingDocs,...additionalCandidates].filter(other=>other&&other.id!==id&&bookDuplicateMatch(duplicateBase,[other]));
  const manual=d.metadataReviewed||d.metadata_reviewed||d.metadataSource==='manual'||d.metadata_source==='manual';
  const publisherId=detectedPublisherId;
  const worldcatQuery=publisherId?'mn='+String(publisherId.value).replace(/[^0-9A-Z]/gi,'').toLowerCase():null;
  const updates={page_count:pdf.numPages,metadata_error:null,metadata_checked_at:new Date().toISOString(),metadata_evidence:{
   pageCount:pdf.numPages,sampledPages,
   extractedTitle:exactMelosMatch?external.title:extractedTitle,
   filenameTitle:filename.title,
   authors:exactMelosMatch?proposedAuthors:pdfAuthors,
   identifiers:persistedIdentifiers,
   repeatedLines,
   publisher:exactMelosMatch?(external.publisher||''):pdfPublisher,
   year:exactMelosMatch?null:pdfYear,
   ...(exactMelosMatch?{metadataAuthority:'Ediciones Melos · código exacto verificado',pdfExtracted:{title:extractedTitle,filenameTitle:filename.title,authors:pdfAuthors,identifiers,publisher:pdfPublisher,year:pdfYear,repeatedLines}}:{}),
   catalogLookup:{attempts:lookupTrace,selected:external?{source:external.source,sourceUrl:external.sourceUrl||null,matchedIdentifier:external.identifierMatch||null,recoveredIdentifiers:external.identifiers||[]}:null,noExactMatch:!external,worldcatQuery},
   melosCatalog:exactMelosMatch?external.catalogDetails:null
  }};
  if(exactMelosMatch){
   // Exact publisher-number match makes the official catalog the source of truth.
   updates.title=String(external.title||'').slice(0,300);
   updates.authors=proposedAuthors.slice(0,20);
   updates.isbn=external.isbns?.[0]?metadataValidIsbn(external.isbns[0]):null;
   updates.publisher=String(external.publisher||'').slice(0,200)||null;
   updates.publication_year=external.year||null;
   updates.description=String(external.description||'');
   const tags=metadataBuildTags({filename:'',text:'',kind:'music_score',catalog:external,accepted:true,embeddedTags:[],publisher:external.publisher||'',identifiers:persistedIdentifiers});
   updates.tags=tags;
   updates.category=metadataCategoryFromTags(tags,'music_score');
   updates.bibliographic_identifiers=persistedIdentifiers;
   updates.metadata_source='pdf_text';
   updates.metadata_reviewed=false;
  }else if(!manual){
   if(metadataTitleUsable(proposedTitle))updates.title=proposedTitle.slice(0,300);
   if(proposedAuthors.length)updates.authors=proposedAuthors.slice(0,20);
   else if((d.authors||[]).length&&!pdfAuthors.length)updates.authors=[];
   if(isbn)updates.isbn=metadataValidIsbn(isbn);
   else if(accepted&&external.isbns?.[0])updates.isbn=metadataValidIsbn(external.isbns[0]);
   if((accepted&&external.publisher)||pdfPublisher)updates.publisher=String((accepted&&external.publisher)||pdfPublisher).slice(0,200);
   if((accepted&&external.year)||pdfYear)updates.publication_year=(accepted&&external.year)||pdfYear;
   const tags=metadataBuildTags({filename:originalFilename||filename.raw,text:normalized,kind:finalKind,catalog:external,accepted,embeddedTags,publisher:(accepted&&external.publisher)||pdfPublisher,identifiers});
   if(tags.length)updates.tags=tags;
   if(accepted&&external.description&&!d.description)updates.description=external.description;
   if(!d.category||d.category==='General'||accepted||finalKind!=='unknown')updates.category=metadataCategoryFromTags(tags,finalKind);
   updates.bibliographic_identifiers=persistedIdentifiers;
   updates.metadata_source=(identifiers.length||pdfPublisher||pdfYear||pageTitle)?'pdf_text':(embeddedTitle||infoAuthor||embeddedTags.length?'embedded':'filename');
   updates.metadata_reviewed=false;
  }else{
   updates.metadata_source='manual';
   updates.metadata_reviewed=true;
  }
  const visibleCandidate=external&&external.score>=72?external:null;
  const matchStatus=possibleDuplicates.length?'duplicate':accepted?'matched':visibleCandidate?'review':finalKind==='other'||finalKind==='periodical'||finalKind==='article'?'non_book':'unmatched';
  updates.metadata_match_status=matchStatus;
  updates.metadata_confidence=external?external.score:null;
  updates.document_kind=finalKind;
  updates.metadata_candidate=visibleCandidate&&!accepted?{
   ...visibleCandidate,
   evidence:{
    filename:filename.raw,filenameTitle:filename.title,filenameAuthors:filename.authors,
    firstPagesTitle:extractedTitle,firstPagesAuthors:pdfAuthors,isbnFound:isbn,publisherFound:pdfPublisher,
    yearFound:pdfYear,identifiersFound:identifiers,repeatedLines,repeatedPageCount:sampledPages.length,sampledPages
   }
  }:null;
  updates.metadata_status=manual||accepted?'complete':'partial';
  if(possibleDuplicates.length)updates.metadata_error='Posible coincidencia con "'+String(possibleDuplicates[0].title||'otro registro')+'". Verificá si son copias o ediciones distintas.';
  else if(matchStatus==='review')updates.metadata_error='Se encontró una posible coincidencia de catálogo de '+external.score+'/100. Confirmá título, autor e identificadores antes de aplicarla.';
  else if(matchStatus==='non_book')updates.metadata_error='El documento parece ser una publicación no monográfica. Revisá su tipo antes de publicarlo.';
  const matchedIdentifierType=external?.identifierMatch?.type||null;
  const exactIsbnMatch=accepted&&external?.score===100&&matchedIdentifierType==='isbn'&&
   external.titleSimilarity>=.92&&metadataTitleIsSpecific(primaryTitle)&&
   metadataTitleIsSpecific(external.title);
  const completeIsbnMetadata=exactIsbnMatch&&proposedAuthors.length>0&&
   !!(external.publisher||pdfPublisher||d.publisher)&&
   !!(external.year||pdfYear||d.year||d.publication_year)&&
   !!(isbn||external.isbns?.length)&&
   !!((updates.tags||d.tags||[]).length);
  const safeCatalogMatch=exactMelosMatch||completeIsbnMetadata;
  const autoPublished=safeCatalogMatch&&!possibleDuplicates.length&&
   (d.uploadStatus||d.upload_status)==='stored'&&
   ['book','music_score'].includes(finalKind);
  updates.metadata_evidence.autoPublication={
   eligible:safeCatalogMatch,
   published:autoPublished,
   reason:autoPublished?'Coincidencia editorial exacta o ISBN verificado con título concordante y ficha completa':
    possibleDuplicates.length?'Bloqueado por posible duplicado':
    exactIsbnMatch&&!completeIsbnMetadata?'Ficha ISBN incompleta':
    accepted?'La coincidencia no cumple los requisitos de autopublicación':'Sin coincidencia bibliográfica aceptada'
  };
  if(autoPublished)updates.is_published=true;
  const{error}=await db.from('documents').update(updates).eq('id',id);
  if(error)throw error;
  return{...updates,possibleDuplicates,candidate:external||null,accepted,kind:finalKind,identifiers,repeatedLines,sampledPages};
 }finally{try{await task.destroy()}catch{}}
}

async function signOut(){if(live)await db.auth.signOut();me=null;books=[];pendingDocs=[];users=[];collections=[];selectedFiles=[];role='reader';page='home';query='';sortBy='title';sortDir='asc';viewMode='grid';density=3;filterCollection='';filterCategory='';favs.clear();history=[];bookAdminStatus='all';selectedBookIds.clear();login()}
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
