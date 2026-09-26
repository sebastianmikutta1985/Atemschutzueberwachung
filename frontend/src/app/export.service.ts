import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { environment } from '../environments/environment';
import { DruckInfo, Einsatz, Trupp } from './models';
import { TranslationService } from './translation.service';

// Einsatzbericht als Excel- oder PDF-Datei (aus dem Dashboard ausgelagert).
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(TranslationService);
  private readonly baseUrl = environment.apiBaseUrl;

  private formatDateTime(value: string | null | undefined): string {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const pad = (v: number) => v.toString().padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${this.i18n.t('common.timeSuffix')}`;
  }
  exportXlsx(einsatz: Einsatz): void {
    this.http
      .get<Trupp[]>(`${this.baseUrl}/einsaetze/${einsatz.id}/trupps`)
      .subscribe((list) => {
        const formatMessungen = (values: DruckInfo[]) =>
          values
            .map((m) => `${m.druckBar} bar | ${this.formatDateTime(m.zeit)}`)
            .join(' | ');

        const einsatzStatus =
          einsatz.status === 'aktiv'
            ? this.i18n.t('dashboard.operationStateActive')
            : einsatz.status === 'beendet'
              ? this.i18n.t('dashboard.ended')
              : einsatz.status;

        const einsatzSheet = XLSX.utils.aoa_to_sheet([
          [this.i18n.t('dashboard.exportSectionIncident')],
          [
            this.i18n.t('dashboard.exportColName'),
            this.i18n.t('dashboard.exportColPlace'),
            this.i18n.t('dashboard.exportColAlarmTime'),
            this.i18n.t('dashboard.exportColStatus'),
            this.i18n.t('dashboard.exportColEndTime')
          ],
          [
            einsatz.name,
            einsatz.ort,
            this.formatDateTime(einsatz.alarmzeit),
            einsatzStatus,
            einsatz.endzeit ? this.formatDateTime(einsatz.endzeit) : '-'
          ]
        ]);

        const truppRows = [
          [
            this.i18n.t('dashboard.exportColCrewName'),
            this.i18n.t('dashboard.exportColPerson1'),
            this.i18n.t('dashboard.exportColPerson2'),
            this.i18n.t('dashboard.exportColStartTime'),
            this.i18n.t('dashboard.exportColEndTime'),
            this.i18n.t('dashboard.exportColStartPressureP1'),
            this.i18n.t('dashboard.exportColStartPressureP2'),
            this.i18n.t('dashboard.exportColWarnTime'),
            this.i18n.t('dashboard.exportColMaxTime'),
            this.i18n.t('dashboard.exportColMeasurementsP1'),
            this.i18n.t('dashboard.exportColMeasurementsP2')
          ],
          ...list.map((t) => [
            t.bezeichnung,
            t.person1Name,
            t.person2Name,
            this.formatDateTime(t.startzeit),
            t.endzeit ? this.formatDateTime(t.endzeit) : '-',
            t.startdruckPerson1Bar,
            t.startdruckPerson2Bar,
            t.warnzeitMin,
            t.maxzeitMin,
            formatMessungen(t.druckMessungenPerson1 || []),
            formatMessungen(t.druckMessungenPerson2 || [])
          ])
        ];

        const truppSheet = XLSX.utils.aoa_to_sheet(truppRows);

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, einsatzSheet, this.i18n.t('dashboard.exportSheetIncident'));
        XLSX.utils.book_append_sheet(workbook, truppSheet, this.i18n.t('dashboard.exportSheetCrews'));

        const safeName = (einsatz.name || 'Einsatz')
          .replace(/[^a-z0-9äöüÄÖÜß_\\-]+/gi, '_');
        const alarm = new Date(einsatz.alarmzeit);
        const stamp = Number.isNaN(alarm.getTime()) ? new Date() : alarm;
        const pad = (v: number) => v.toString().padStart(2, '0');
        const dateLabel = `${pad(stamp.getDate())}.${pad(stamp.getMonth() + 1)}.${stamp.getFullYear()}`;
        const filename = `${this.i18n.t('common.appName')}_Einsatzbericht_${safeName}_${dateLabel}.xlsx`;
        XLSX.writeFile(workbook, filename, { compression: true });
      });
  }

  exportPdf(einsatz: Einsatz): void {
    this.http
      .get<Trupp[]>(`${this.baseUrl}/einsaetze/${einsatz.id}/trupps`)
      .subscribe((list) => {
        const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
        const margin = 40;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        let y = 44;

        const drawHeader = () => {
          doc.setFillColor(36, 23, 20);
          doc.rect(0, 0, pageWidth, 80, 'F');
          doc.setTextColor(246, 239, 232);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(18);
          doc.text(
            this.i18n.t('dashboard.pdfTitle', { appName: this.i18n.t('common.appName') }),
            margin,
            48
          );
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.text(
            this.i18n.t('dashboard.pdfCreatedAt', { value: new Date().toLocaleString() }),
            margin,
            66
          );
          doc.setTextColor(33, 33, 33);
          y = 96;
        };

        drawHeader();

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(this.i18n.t('dashboard.pdfIncidentData'), margin, y);
        y += 16;

        doc.setFont('helvetica', 'normal');
        const einsatzStatus =
          einsatz.status === 'aktiv'
            ? this.i18n.t('dashboard.operationStateActive')
            : einsatz.status === 'beendet'
              ? this.i18n.t('dashboard.ended')
              : einsatz.status;
        const info = [
          [this.i18n.t('dashboard.exportSectionIncident'), einsatz.name],
          [this.i18n.t('dashboard.exportColPlace'), einsatz.ort],
          [this.i18n.t('dashboard.exportColAlarmTime'), this.formatDateTime(einsatz.alarmzeit)],
          [this.i18n.t('dashboard.exportColStatus'), einsatzStatus],
          [this.i18n.t('dashboard.end'), this.formatDateTime(einsatz.endzeit ?? '')]
        ];
        for (const [label, value] of info) {
          doc.setTextColor(90, 70, 60);
          doc.text(`${label}:`, margin, y);
          doc.setTextColor(33, 33, 33);
          doc.text(String(value), margin + 90, y);
          y += 16;
        }
        y += 10;

        const formatMessungen = (values: DruckInfo[]) =>
          values.map((m) => `${m.druckBar} bar | ${this.formatDateTime(m.zeit)}`);

        const addTableHeader = () => {
          doc.setFillColor(240, 140, 42);
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.rect(margin, y, pageWidth - margin * 2, 24, 'F');
          const headers = [
            this.i18n.t('dashboard.pdfCrew'),
            this.i18n.t('dashboard.pdfPersons'),
            this.i18n.t('dashboard.start'),
            this.i18n.t('dashboard.pdfPressure'),
            this.i18n.t('dashboard.pdfWarnMax'),
            this.i18n.t('dashboard.pdfMeasurements')
          ];
          const cols = [110, 150, 145, 70, 70, pageWidth - margin * 2 - 545];
          let x = margin + 8;
          headers.forEach((h, i) => {
            doc.text(h, x, y + 16);
            x += cols[i];
          });
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(33, 33, 33);
          y += 28;
        };

        addTableHeader();

        for (const t of list) {
          const cols = [110, 150, 145, 70, 70, pageWidth - margin * 2 - 545];
          const m1 = formatMessungen(t.druckMessungenPerson1 || []);
          const m2 = formatMessungen(t.druckMessungenPerson2 || []);
          const mLines = [
            ...(m1.length ? m1.map((m) => `P1: ${m}`) : []),
            ...(m2.length ? m2.map((m) => `P2: ${m}`) : [])
          ];
          const mText = mLines.length ? mLines.join('\n') : '-';
          const wrapped = doc.splitTextToSize(mText, cols[5] - 8);
          const rowHeight = Math.max(48, 20 + wrapped.length * 12);
          if (y + rowHeight > pageHeight - 40) {
            doc.addPage();
            drawHeader();
            addTableHeader();
          }
          doc.setDrawColor(225, 220, 212);
          doc.rect(margin, y, pageWidth - margin * 2, rowHeight);

          let x = margin + 8;
          doc.text(String(t.bezeichnung), x, y + 16);
          x += cols[0];
          doc.text(`P1: ${t.person1Name}\nP2: ${t.person2Name}`, x, y + 14);
          x += cols[1];
          doc.text(this.formatDateTime(t.startzeit), x, y + 16);
          x += cols[2];
          doc.text(`P1 ${t.startdruckPerson1Bar}\nP2 ${t.startdruckPerson2Bar}`, x, y + 14);
          x += cols[3];
          doc.text(`${t.warnzeitMin}/${t.maxzeitMin}`, x, y + 16);
          x += cols[4];
          doc.text(wrapped, x, y + 16);

          y += rowHeight;
        }

        const alarm = new Date(einsatz.alarmzeit);
        const stamp = Number.isNaN(alarm.getTime())
          ? new Date()
          : alarm;
        const pad = (v: number) => v.toString().padStart(2, '0');
        const dateLabel = `${pad(stamp.getDate())}.${pad(stamp.getMonth() + 1)}.${stamp.getFullYear()}`;
        const safeName = (einsatz.name || 'Einsatz')
          .replace(/[^a-z0-9äöüÄÖÜß_\\-]+/gi, '_');
        doc.save(`${this.i18n.t('common.appName')}_Einsatzbericht_${safeName}_${dateLabel}.pdf`);
      });
  }
}
