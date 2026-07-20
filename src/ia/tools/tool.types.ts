/**
 * Tipos base del sistema de tools del agente IA.
 *
 * Principio maestro (ver src/ia/README.md §4): cada tool recibe DOS
 * fuentes de datos:
 *   - `args`: lo que llena el LLM (extraído de la conversación) — NO confiable.
 *   - `ctx`:  lo que inyecta el EJECUTOR (empresaId, sedeId, celular...) —
 *             el LLM NUNCA lo ve ni lo toca.
 * El LLM propone; el backend dispone.
 */

/** Un producto/variante que el agente ya mostró en la conversación. */
export interface CatalogoItem {
  id: string; // productoId real
  varianteId?: string | null;
  nombre: string; // nombre mostrado (producto o "producto variante")
}

/** Contexto inyectado por el ejecutor — jamás proviene del LLM. */
export interface ContextoTool {
  empresaId: string;
  sedeId?: string | null;
  celular?: string | null; // remitente de WhatsApp (para ownership)
  conversacionId?: string | null; // idempotencia en escrituras
  /**
   * Catálogo mostrado en la conversación (buscarProducto/verDetalle lo llenan,
   * crearVenta lo lee para resolver el id real aunque el LLM mande el nombre).
   * Array MUTABLE compartido en el turno; el bot lo persiste entre turnos.
   */
  catalogoReciente?: CatalogoItem[];
  /** Última búsqueda del turno/conversación (buscarProducto la escribe):
   *  permite que "muéstrame más" pagine en vez de inventar. */
  ultimaBusqueda?: { query: string; pagina: number; hayMas: boolean };
}

/**
 * Resultado estructurado de una tool. `ok:false` con `motivo` es un
 * ERROR-COMO-DATO: el LLM debe poder reaccionar (ej. "STOCK_INSUFICIENTE"),
 * nunca una excepción cruda que rompa la conversación.
 */
export interface ResultadoTool {
  ok: boolean;
  motivo?: string;
  [clave: string]: unknown;
}

/** Definición de una tool que se le entrega al LLM. */
export interface DefinicionTool {
  /** Nombre que el LLM invoca. */
  nombre: string;
  /** Descripción para el LLM: cuándo y cómo usar la tool. */
  descripcion: string;
  /** JSON Schema de los `args` que llena el LLM. */
  parametros: Record<string, unknown>;
  /** Valida, llama al servicio y devuelve el resultado estructurado. */
  ejecutar(
    args: Record<string, unknown>,
    ctx: ContextoTool,
  ): Promise<ResultadoTool>;
}
