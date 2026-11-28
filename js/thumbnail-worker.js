const PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
let pdfjsPromise=null;

async function getPdfJs(){
 if(!pdfjsPromise){
  pdfjsPromise=import(PDFJS_URL).then(pdfjs=>{
   pdfjs.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL;
   return pdfjs;
  });
 }
 return pdfjsPromise;
}

async function generateThumbnail(recordId,token,gateway){
 const endpoint=gateway+'/thumbnail/'+encodeURIComponent(recordId);
 const authorization={Authorization:'Bearer '+token};
 const existing=await fetch(endpoint,{method:'HEAD',headers:authorization});
 if(existing.ok&&existing.headers.get('X-Thumbnail-Variant')==='small')return 'skipped';
 if(!existing.ok&&existing.status!==404){
  throw new Error('No se pudo comprobar la miniatura · HTTP '+existing.status);
 }

 const pdfjs=await getPdfJs();
 const loadingTask=pdfjs.getDocument({
  url:gateway+'/pdf/'+encodeURIComponent(recordId),
  httpHeaders:authorization,
  withCredentials:false,
  disableAutoFetch:true,
  disableStream:true,
  rangeChunkSize:65536,
  isEvalSupported:false
 });
 let pdf=null,page=null,canvas=null;
 try{
  pdf=await loadingTask.promise;
  page=await pdf.getPage(1);
  const base=page.getViewport({scale:1}),width=160,height=220;
  const scale=Math.min(width/base.width,height/base.height);
  const viewport=page.getViewport({scale});
  if(typeof OffscreenCanvas==='undefined')throw new Error('Este navegador no admite OffscreenCanvas.');
  canvas=new OffscreenCanvas(width,height);
  const context=canvas.getContext('2d',{alpha:false});
  if(!context)throw new Error('No se pudo crear el lienzo fuera de pantalla.');
  context.fillStyle='#fff';context.fillRect(0,0,width,height);
  const offsetX=(width-viewport.width)/2,offsetY=(height-viewport.height)/2;
  await page.render({
   canvasContext:context,
   viewport,
   transform:[1,0,0,1,offsetX,offsetY],
   background:'rgb(255,255,255)'
  }).promise;
  const blob=await canvas.convertToBlob({type:'image/jpeg',quality:0.78});
  if(blob.size>512*1024)throw new Error('La miniatura supera el límite de 512 KiB.');
  const uploaded=await fetch(endpoint,{
   method:'PUT',
   headers:{...authorization,'Content-Type':'image/jpeg'},
   body:blob
  });
  if(!uploaded.ok){
   const detail=await uploaded.text().catch(()=>'');
   throw new Error(detail||('No se pudo guardar la miniatura · HTTP '+uploaded.status));
  }
  const result=await uploaded.json().catch(()=>({}));
  return result.alreadyExists?'skipped':'created';
 }finally{
  try{page?.cleanup()}catch{}
  if(pdf){try{await pdf.destroy()}catch{}}
  else{try{await loadingTask.destroy()}catch{}}
  if(canvas){canvas.width=0;canvas.height=0}
 }
}

self.addEventListener('message',async event=>{
 const {recordId,token,gateway}=event.data||{};
 if(!recordId||!token||!gateway)return;
 try{
  const result=await generateThumbnail(recordId,token,gateway);
  self.postMessage({recordId,ok:true,result});
 }catch(error){
  self.postMessage({recordId,ok:false,error:String(error?.message||error)});
 }
});
