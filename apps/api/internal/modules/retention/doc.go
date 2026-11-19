// Package retention anonimiza a los clientes cuyos datos personales vencieron
// (RN-DAT-03, DEC-025, DEC-042, DEC-054, DEC-185): 24 meses por defecto desde
// su última actividad, con el plazo de cada negocio.
//
// Solo lo usa el proceso worker. Todo el trabajo ocurre en la base, dentro de
// customer_anonymize_expired: reclamar, anonimizar y registrar el lote en
// customer_anonymization_run van en una misma transacción (DEC-053). Este
// paquete solo decide cuántos lotes correr por pasada. La solicitud individual
// del titular la ejecuta el operador con customer_anonymize_request (ver
// nava-docs/agenda/deploy/README.md); no pasa por aquí.
package retention
