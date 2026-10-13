import * as reportService from './service/report.service.js';

export async function overview(req, res) {
  res.json(await reportService.overview(req.businessId, req));
}

export async function occupancy(req, res) {
  res.json(await reportService.occupancy(req.businessId, req));
}

export async function services(req, res) {
  res.json(await reportService.services(req.businessId, req));
}

export async function cancellations(req, res) {
  res.json(await reportService.cancellations(req.businessId, req));
}

export async function noShow(req, res) {
  res.json(await reportService.noShow(req.businessId, req));
}

/**
 * Exportacion a CSV.
 *
 * Se manda como adjunto en vez de como JSON: un CSV dentro de un `res.json` obliga
 * al frontend a construir un Blob y a decidir el nombre del archivo, cuando el
 * navegador puede bajarlo solo con el `Content-Disposition`.
 */
export async function exportCsv(req, res) {
  const { nombre, contenido, total } = await reportService.exportCsv(req.businessId, req);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);

  /// El BOM es lo que hace que Excel abra los acentos bien. Sin el, "Martínez" sale
  /// como "MartÃ­nez", que es el primer complaint que llega de quien exporta.
  res.send(`﻿${contenido}`);

  req.log?.info?.('exportacion csv', { file: nombre, total });
}

export default { overview, occupancy, services, cancellations, noShow, exportCsv };
