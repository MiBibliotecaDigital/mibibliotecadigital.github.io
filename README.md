# Mi Biblioteca Digital

Biblioteca web privada: GitHub Pages sirve la interfaz; Supabase gestiona identidad, roles, catálogo y permisos; Cloudflare R2 guarda los documentos privados; un Cloudflare Worker entrega PDF autorizados mediante streaming y HTTP Range.

## Demo
Las cuentas de demostración y los tres PDF ficticios solo funcionan en modo demo. No son credenciales reales ni protegen documentos privados.

## Publicación
GitHub Settings > Pages > Deploy from a branch > main > /(root). URL: https://mibibliotecadigital.github.io/

## Backend
1. Crear un proyecto Supabase y ejecutar, en orden, `supabase/migrations/202611270001_initial_schema.sql` y `supabase/migrations/202611270002_harden_profile_updates.sql` en SQL Editor.
2. Crear el primer usuario en Supabase Auth y promoverlo a administrador: `update public.profiles set role='admin' where id='UUID';`
3. Desplegar `supabase/functions/admin-create-user` con Supabase CLI.
4. Configurar secretos de esa función: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN=https://mibibliotecadigital.github.io`.
5. En Cloudflare Workers, crear un Worker desde `cloudflare/worker.js`; usar `wrangler.toml` como referencia de configuración y enlazar el bucket privado existente mediante binding R2 llamado `BIBLIOTECA`.
6. Configurar variables del Worker: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (o anon key compatible), `APP_ORIGIN=https://mibibliotecadigital.github.io`.
7. Configurar `js/config.js` con Supabase Project URL, publishable/anon key y URL del Worker en `pdfGatewayUrl`; establecer `demoMode:false`. Nunca publicar service-role ni credenciales S3.
8. El Worker usa el binding R2 `BIBLIOTECA`; no necesita claves S3 ni tokens R2. Mantener el bucket privado, sin Public Development URL ni dominio público.
9. Las cargas se realizan desde el panel de administrador mediante la ruta multipart del Worker, con selección múltiple de hasta 20 archivos por tanda. Cada operación vuelve a verificar el JWT de Supabase y el perfil activo con rol `admin`. Los archivos se transfieren en partes de 10 MiB (límite actual de la interfaz: 2 GiB por archivo). Al terminar, cada documento se registra como borrador privado (`is_published=false`), con un título provisional derivado del nombre del archivo y sin exigir metadatos bibliográficos. Desde **Metadatos**, el administrador puede completar o corregir título, autores, año, categoría, colección y descripción; solo al elegir **Guardar y publicar** aparece en el catálogo de lectores. Si falla el registro en Supabase, el Worker elimina el objeto para evitar archivos huérfanos.
10. Verificar con cuentas admin, lector autorizado, lector sin grant y usuario sin sesión. La pasarela aplica la política RLS de `documents` en cada GET/HEAD y cada Range. Los borradores no se muestran a lectores: la autorización final depende de RLS, no de la interfaz.

## Entrega protegida de PDF
El navegador no recibe una URL firmada de R2. PDF.js envía el JWT de Supabase en el encabezado Authorization a la pasarela Worker. La pasarela consulta el registro del documento mediante PostgREST con ese JWT; RLS determina si el usuario activo tiene permiso. Solo entonces transmite el objeto desde el binding privado R2. Las respuestas admiten Range/206 para documentos grandes y llevan Cache-Control no-store y X-Robots-Tag noindex.

Esto impide el acceso sin sesión válida y evita exponer URLs públicas o URLs temporales de R2. No es DRM: un usuario autorizado puede guardar, imprimir, capturar o copiar el contenido que recibe.\n\nLa asistencia bibliográfica con ChatGPT se realiza fuera de la web: el administrador puede adjuntar los PDF originales en una conversación de ChatGPT para recibir propuestas de metadatos. La página estática no invoca por sí sola al modelo ni expone claves de API.

## Cookies y sesión
La autenticación usa el token de sesión de Supabase en un encabezado HTTP, no una cookie compartida entre github.io y workers.dev. El token no se coloca en la URL. La autorización se vuelve a comprobar en cada petición de documento.

## Notas
- `r2-document-url` está retirado y responde HTTP 410; no desplegarlo ni usarlo.
- `admin-create-user` sigue siendo una Edge Function de Supabase.
- El gateway Worker debe desplegarse y configurarse antes de activar el modo real.
