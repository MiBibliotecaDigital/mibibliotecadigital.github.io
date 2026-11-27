# Mi Biblioteca Digital
Interfaz GitHub Pages, usuarios/catalogo Supabase y documentos privados en Cloudflare R2.

## Demo (ficticia, no segura)
Administrador: admin@biblioteca.local / admin1234
Lector: demo@biblioteca.local / demo1234
Los PDF de demo son publicos y ficticios. No subir libros privados hasta configurar Supabase y R2.

## Publicacion
GitHub Settings > Pages > Deploy from a branch > main > /(root). URL: https://mibibliotecadigital.github.io/

## Backend real
1. Ejecutar supabase/migrations/202611270001_initial_schema.sql en SQL Editor.
2. Crear un usuario en Supabase Auth; copiar UUID y promover: update public.profiles set role='admin' where id='UUID';
3. Pegar Project URL y anon/publishable key en js/config.js y cambiar demoMode a false. Nunca pegar service_role.
4. Desplegar Edge Functions r2-document-url y admin-create-user con Supabase CLI.
5. Guardar como secretos de funciones R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET=biblioteca-digital-archivos y APP_ORIGIN=https://mibibliotecadigital.github.io.
6. Mantener R2 privado, crear token limitado al bucket y configurar CORS para el origen de Pages.
7. Cargar documentos en R2 y crear registros en public.documents. Probar RLS con un lector antes de guardar archivos privados.
