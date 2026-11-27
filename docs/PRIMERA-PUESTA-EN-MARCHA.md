# Primera puesta en marcha

La demo utiliza cuentas y documentos ficticios. No subir libros privados hasta terminar los pasos de backend.

1. Activar GitHub Pages desde main / root.
2. Crear Supabase y ejecutar la migración inicial en SQL Editor.
3. Crear el primer usuario Auth y promover su perfil a admin.
4. Desplegar la función admin-create-user y configurar sus secretos.
5. Desplegar el Worker de `cloudflare/worker.js`, enlazando el bucket privado mediante el binding `BIBLIOTECA`.
6. Configurar en el Worker `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `APP_ORIGIN`.
7. Configurar `js/config.js` con URL y clave publicable de Supabase, URL del Worker en `pdfGatewayUrl` y `demoMode:false`.
8. Subir documentos a R2 y registrar sus claves internas en `documents.r2_key`.
9. Probar autorización y denegación con varios perfiles antes de cargar libros reales.

La entrega PDF usa PDF.js con JWT en Authorization y un Worker que consulta Supabase/PostgREST con RLS antes de transmitir desde R2. Se admiten solicitudes Range. No se generan URLs firmadas. La antigua función `r2-document-url` está retirada (HTTP 410).

R2 debe permanecer privado. No habilitar Public Development URL ni Custom Domain público. Nunca guardar service-role keys ni credenciales R2 en GitHub o en el navegador.
