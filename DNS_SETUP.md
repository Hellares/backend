# 🌐 Configuración DNS - syncronize.net.pe

## Subdominios configurados

Tu aplicación está configurada para usar los siguientes subdominios:

- **API Backend**: `api.syncronize.net.pe`
- **Grafana (Observabilidad)**: `grafana.syncronize.net.pe`
- **Frontend** (futuro): `app.syncronize.net.pe` o `syncronize.net.pe`

---

## 📋 Records DNS a configurar

Ve al panel de tu proveedor de DNS (donde registraste el dominio) y agrega los siguientes records:

### Records tipo A (apuntan a tu VPS)

Asumiendo que tu VPS tiene la IP: `86.48.26.221`

```
Tipo    Nombre      Valor           TTL
----    ------      -----           ---
A       api         86.48.26.221    3600
A       grafana     86.48.26.221    3600
A       app         86.48.26.221    3600
A       @           86.48.26.221    3600
```

### Alternativa: CNAME (si prefieres)

Si ya tienes un record A principal, puedes usar CNAME:

```
Tipo    Nombre      Valor                   TTL
----    ------      -----                   ---
A       @           86.48.26.221            3600
CNAME   api         syncronize.net.pe       3600
CNAME   grafana     syncronize.net.pe       3600
CNAME   app         syncronize.net.pe       3600
```

---

## 🔐 Certificados SSL/HTTPS

La configuración de Traefik en tu `docker-compose.yml` ya está lista para:

1. ✅ **Obtener certificados SSL automáticamente** con Let's Encrypt
2. ✅ **Redirigir HTTP → HTTPS** automáticamente
3. ✅ **Renovar certificados** antes de que expiren

### Requisitos para Let's Encrypt:

- Los subdominios **DEBEN** apuntar a tu VPS antes de desplegar
- Traefik debe estar configurado con `certresolver=letsencrypt`
- Los puertos 80 y 443 deben estar abiertos en tu VPS

---

## 🚀 URLs finales

Una vez configurado el DNS (tarda 5-30 minutos en propagar):

- **API**: https://api.syncronize.net.pe
- **Grafana**: https://grafana.syncronize.net.pe
- **Health Check**: https://api.syncronize.net.pe/api
- **API Docs** (si está habilitado): https://api.syncronize.net.pe/api/docs

---

## ✅ Verificar configuración DNS

### Desde tu terminal:

```bash
# Verificar que el DNS apunta correctamente
nslookup api.syncronize.net.pe
nslookup grafana.syncronize.net.pe

# O con dig (más detallado)
dig api.syncronize.net.pe +short
dig grafana.syncronize.net.pe +short
```

**Resultado esperado**: Debe mostrar la IP de tu VPS: `86.48.26.221`

### Desde el navegador:

Abre: https://www.whatsmydns.net/#A/api.syncronize.net.pe

Verifica que la propagación DNS esté completa globalmente.

---

## 🔧 Traefik - Verificar configuración

Asegúrate de que tu Traefik en Portainer tenga:

1. **Entrypoints configurados**:
   ```yaml
   entryPoints:
     web:
       address: ":80"
     websecure:
       address: ":443"
   ```

2. **Cert Resolver configurado**:
   ```yaml
   certificatesResolvers:
     letsencrypt:
       acme:
         email: tu-email@syncronize.net.pe
         storage: /letsencrypt/acme.json
         httpChallenge:
           entryPoint: web
   ```

---

## 🌍 Configurar en Portainer

En las **variables de entorno** de tu stack en Portainer, actualiza:

```env
CORS_ORIGIN=https://app.syncronize.net.pe,https://syncronize.net.pe
BACKEND_URL=https://api.syncronize.net.pe
EMAIL_FROM=noreply@syncronize.net.pe
```

---

## 📊 Acceso a servicios

| Servicio | URL | Credenciales |
|----------|-----|--------------|
| API Backend | https://api.syncronize.net.pe | - |
| Grafana | https://grafana.syncronize.net.pe | Ver variables GRAFANA_ADMIN_USER/PASSWORD |
| Health Check | https://api.syncronize.net.pe/api | - |

---

## 🐛 Troubleshooting

### DNS no resuelve
- Espera 5-30 minutos para propagación
- Verifica en whatsmydns.net
- Contacta a tu proveedor de DNS

### Certificado SSL no se genera
- Verifica que el DNS ya esté apuntando correctamente
- Revisa logs de Traefik: `docker logs traefik-container`
- Asegúrate de que los puertos 80/443 estén abiertos

### Error 502 Bad Gateway
- El backend no está levantado
- Revisa logs: `docker logs saas-backend`
- Verifica healthcheck del backend

---

## 📝 Notas adicionales

- **Tiempo de propagación DNS**: 5 minutos - 48 horas (usualmente < 30 min)
- **Renovación SSL**: Traefik renueva automáticamente 30 días antes de expirar
- **CORS**: Ya está configurado para permitir solicitudes desde `app.syncronize.net.pe`
