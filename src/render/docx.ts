import { escapeXml } from './svg';
import { createZip } from './zip';

// Papier à en-tête Word (KIT-04) : document OOXML minimal écrit à la main — logo en en-tête,
// coordonnées en pied de page —, sans dépendance. Il s'ouvre dans Word, LibreOffice et Google Docs.

export interface LetterheadDocxInput {
  title: string;
  logoPng: Buffer;
  /** Taille du logo dans l'en-tête, en mm. */
  logoWidthMm: number;
  logoHeightMm: number;
  /** Lignes du pied de page (coordonnées). */
  footer: string[];
  /** Couleur du filet du pied de page, #rrggbb. */
  accent: string;
}

const EMU_PER_MM = 36_000;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const contentTypes = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const rootRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const documentRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL}/header" Target="header1.xml"/><Relationship Id="rId3" Type="${REL}/footer" Target="footer1.xml"/></Relationships>`;

const headerRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/image" Target="media/logo.png"/></Relationships>`;

// Arial 11 pt : présente partout, contrairement aux polices de la marque.
const styles = `${XML}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;

function paragraph(text: string, props = '') {
  const properties = props ? `<w:pPr>${props}</w:pPr>` : '';
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

export function letterheadDocx(input: LetterheadDocxInput): Buffer {
  const cx = Math.round(input.logoWidthMm * EMU_PER_MM);
  const cy = Math.round(input.logoHeightMm * EMU_PER_MM);
  const accent = input.accent.replace('#', '').toUpperCase();

  const header = `${XML}<w:hdr xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Logo" descr="${escapeXml(input.title)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>`;

  const footerProps = `<w:pBdr><w:top w:val="single" w:sz="8" w:space="6" w:color="${accent}"/></w:pBdr><w:spacing w:after="0"/><w:jc w:val="center"/><w:rPr><w:color w:val="6B7280"/><w:sz w:val="16"/></w:rPr>`;
  const footerLines = input.footer.length ? input.footer : [input.title];
  const footer = `${XML}<w:ftr xmlns:w="${W}" xmlns:r="${R}">${footerLines
    .map(
      (line, i) =>
        `<w:p><w:pPr>${i === 0 ? footerProps : '<w:spacing w:after="0"/><w:jc w:val="center"/>'}</w:pPr><w:r><w:rPr><w:color w:val="6B7280"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
    )
    .join('')}</w:ftr>`;

  // Corps : trame de courrier à compléter.
  const body = [
    paragraph('Lieu, le date', '<w:jc w:val="right"/>'),
    paragraph(''),
    paragraph('Destinataire'),
    paragraph('Adresse'),
    paragraph(''),
    paragraph('Objet : '),
    paragraph(''),
    paragraph('Madame, Monsieur,'),
    paragraph(''),
  ].join('');
  const document = `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2268" w:right="1418" w:bottom="1701" w:left="1418" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(input.title)}</dc:title><dc:language>fr-FR</dc:language></cp:coreProperties>`;

  return createZip([
    { path: '[Content_Types].xml', data: contentTypes },
    { path: '_rels/.rels', data: rootRels },
    { path: 'docProps/core.xml', data: core },
    { path: 'word/document.xml', data: document },
    { path: 'word/styles.xml', data: styles },
    { path: 'word/_rels/document.xml.rels', data: documentRels },
    { path: 'word/header1.xml', data: header },
    { path: 'word/_rels/header1.xml.rels', data: headerRels },
    { path: 'word/footer1.xml', data: footer },
    { path: 'word/media/logo.png', data: input.logoPng },
  ]);
}
