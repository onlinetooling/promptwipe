// Every string the tool shows, in English and French (hand-written, not
// machine-translated). Values read from a file are passed in as arguments and
// always end up in text nodes, never in HTML.

export type Lang = 'en' | 'fr';

const nEn = new Intl.NumberFormat('en-US');
const nFr = new Intl.NumberFormat('fr-FR');
const NB = ' '; // no-break space before French ":" and "»"

const en = {
  // Static parts of the tool (rendered at build time).
  toolTitle: 'Clean an image',
  drop: 'Drop an image here',
  choose: 'or click to choose a file',
  formats: 'PNG, JPEG or WebP · up to 50 MB · nothing is uploaded',
  pasteHint: 'You can also paste an image (Ctrl+V or ⌘V).',
  noScript: 'The tool needs JavaScript. It runs only in your browser: nothing is sent anywhere.',

  // Progress.
  reading: (name: string) => `Reading ${name}…`,
  done: 'Done.',
  failed: 'Nothing was changed.',
  oneAtATime: 'One image at a time: only the first one was processed.',

  // Verdict and download.
  removedBlocks: (n: number) => (n === 1 ? '1 metadata block removed.' : `${nEn.format(n)} metadata blocks removed.`),
  nothingRemoved: 'No metadata block found in this image.',
  alreadyClean: 'There is nothing to remove: the file is already clean.',
  download: 'Download the clean image',
  fileName: (name: string) => `File name: ${name}`,
  nameTip:
    'A file name such as “ChatGPT Image…” or “ComfyUI_00042_” also tells where the image comes from: rename it if needed.',
  sizes: (before: string, after: string) => `Size: ${before} → ${after}`,
  checkSkippedLarge: 'Very large image (over 40 megapixels): only the file structure was checked, not the decoded picture.',
  checkSkippedUndecodable: 'Your browser cannot display this image, so only the file structure was checked.',
  previewAlt: 'Preview of the cleaned image',

  // Report.
  contained: 'What the image contained',
  removedTitle: 'What was removed',
  keptTitle: 'What was kept',
  nothingReadable: 'No prompt, generation settings, EXIF, XMP or Content Credentials found.',
  pastedNote:
    'Pasted images often lose their metadata on the way to the clipboard. To check the original file, drop it or choose it instead.',
  secTexts: 'Prompt and generation settings',
  secExif: 'EXIF (camera, software, date, location)',
  secXmp: 'XMP',
  secC2pa: 'Content Credentials (C2PA)',
  secOther: 'Other data',
  jpegComment: 'JPEG comment',
  hintA1111: 'written by AUTOMATIC1111, Forge or Fooocus',
  hintComfy: 'written by ComfyUI',
  hintComfyNodes: (n: number) => `ComfyUI workflow, ${n === 1 ? '1 node' : `${nEn.format(n)} nodes`}`,
  hintInvoke: 'written by InvokeAI',
  hintFooocus: 'written by Fooocus',
  chars: (n: number) => (n === 1 ? '1 character' : `${nEn.format(n)} characters`),
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Copy failed: the text is selected, copy it by hand.',
  shownFirst: (n: number) => `Only the first ${nEn.format(n)} characters are shown. “Copy” takes the full text.`,
  fileTruncated: 'The file holds more text than PromptWipe reads (5 MB): the rest is not shown, but it is removed too.',

  exifLabels: {
    ImageDescription: 'Description',
    Make: 'Camera maker',
    Model: 'Camera model',
    Software: 'Software',
    DateTime: 'Date modified',
    DateTimeOriginal: 'Date taken',
    CreateDate: 'Date created',
    Artist: 'Author',
    Copyright: 'Copyright',
    UserComment: 'User comment',
    CameraOwnerName: 'Camera owner',
    BodySerialNumber: 'Camera serial number',
    LensMake: 'Lens maker',
    LensModel: 'Lens model',
    ImageUniqueID: 'Unique image ID',
    XPTitle: 'Title (Windows)',
    XPComment: 'Comment (Windows)',
    XPAuthor: 'Author (Windows)',
    XPKeywords: 'Keywords (Windows)',
    XPSubject: 'Subject (Windows)',
  } as Record<string, string>,
  gps: 'GPS location',
  gpsUnreadable: 'present (could not be read)',
  makerNote: (size: string) => `Maker note: ${size} of manufacturer data`,
  thumbnail: (size: string) => `Embedded thumbnail: ${size}`,

  xmpPacket: (size: string) => `XMP packet: ${size}`,
  creatorTool: 'Creator tool',
  digitalSourceType: 'Digital source type',
  sourceTypes: {
    trainedAlgorithmicMedia: 'Created using generative AI',
    compositeWithTrainedAlgorithmicMedia: 'Edited using generative AI',
    algorithmicMedia: 'Created by an algorithm',
  } as Record<string, string>,
  description: 'Description',
  credit: 'Credit',
  provenance: 'Link to Content Credentials',

  c2paSummary: (n: number, size: string) => `${n === 1 ? '1 manifest' : `${nEn.format(n)} manifests`}, ${size}`,
  c2paGenerator: 'Made with',
  c2paSigner: 'Signed by (declared, signature not verified)',
  c2paTitle: 'Title',
  c2paUnreadable: 'Present, but could not be read. It is removed all the same.',

  trailing: (size: string) => `${size} of data after the end of the image`,
  motionPhoto: 'Motion Photo: the short video stored with the photo is removed.',
  hdrGainMap: 'HDR gain map: removed. On an HDR screen the image may look less bright.',
  secondaryImages: 'Secondary images (MPF), such as a depth map: removed.',

  warnings: {
    'text-budget-exceeded': 'This file holds more than 5 MB of text: only the beginning is shown. All of it is removed.',
    'too-many-texts': 'This file holds more than 1,000 text blocks: only the first ones are shown. All of them are removed.',
    'compressed-text-unreadable': 'A compressed block could not be read. It is removed all the same.',
    'exif-unreadable': 'The EXIF block could not be read. It is removed all the same.',
  } as Record<string, string>,

  kinds: {
    text: 'Text (prompts, settings, workflows)',
    exif: 'EXIF',
    xmp: 'XMP',
    c2pa: 'Content Credentials (C2PA)',
    iptc: 'IPTC / Photoshop',
    comment: 'Comments',
    thumbnail: 'Thumbnails',
    'secondary-image': 'Secondary images',
    trailing: 'Data after the end of the image',
    other: 'Other blocks (dates, resolution, unknown)',
    image: 'Image data',
    color: 'Colour information',
  } as Record<string, string>,
  blockCount: (n: number) => (n === 1 ? '1 block' : `${nEn.format(n)} blocks`),
  allBlocks: 'All blocks, in file order',
  actions: { keep: 'kept', remove: 'removed', rewrite: 'rewritten' } as Record<string, string>,
  moreBlocks: (n: number) => `… and ${nEn.format(n)} more`,
  keptImage: 'The picture itself, byte for byte: no re-encoding, no quality loss',
  keptAnimation: 'The animation, every frame',
  keptColor: (name: string) => `Colour profile: ${name}`,
  keptOrientation: 'The rotation of the photo (EXIF orientation, nothing else)',

  // Errors.
  errTooLarge: 'This file is over 50 MB, the most PromptWipe handles.',
  errGif: 'GIF images are not supported yet.',
  errAvif: 'AVIF images are not supported yet.',
  errHeic:
    'HEIC photos (the iPhone format) are not supported yet. Export the photo as JPEG first, or on the iPhone choose Settings › Camera › Formats › Most Compatible.',
  errUnknown: 'This file is not a PNG, JPEG or WebP image.',
  requestFormat: 'Request this format',
  errMalformed: 'Unexpected file structure: PromptWipe could not read it safely, so nothing was changed.',
  errVariant: 'This image uses a variant of its format that PromptWipe does not handle yet, so nothing was changed.',
  errVerification:
    'The cleaned file did not pass the final check, so it is not offered. Your image was not changed. Please report it with the diagnostic below.',
  errDecode:
    'The cleaned file does not display like the original, so it is not offered. Your image was not changed. Please report it with the diagnostic below.',
  errRead: 'The file could not be read.',
  errInternal: 'Something went wrong in PromptWipe. Your image was not changed. Please report it with the diagnostic below.',
  reportBug: 'Report the problem',

  // Diagnostic.
  diagTitle: 'Diagnostic for a bug report',
  diagNote: 'It describes the structure of the file (format, blocks, sizes), never its content: no prompt, no text, no location.',
  copyDiag: 'Copy the diagnostic',
};

export type Messages = typeof en;

const fr: Messages = {
  toolTitle: 'Nettoyer une image',
  drop: 'Déposez une image ici',
  choose: 'ou cliquez pour choisir un fichier',
  formats: 'PNG, JPEG ou WebP · jusqu’à 50 Mo · rien n’est envoyé',
  pasteHint: 'Vous pouvez aussi coller une image (Ctrl+V ou ⌘V).',
  noScript: `L’outil a besoin de JavaScript. Il ne tourne que dans votre navigateur${NB}: rien n’est envoyé nulle part.`,

  reading: (name) => `Lecture de ${name}…`,
  done: 'Terminé.',
  failed: 'Rien n’a été modifié.',
  oneAtATime: `Une image à la fois${NB}: seule la première a été traitée.`,

  removedBlocks: (n) =>
    n === 1 ? '1 bloc de métadonnées retiré.' : `${nFr.format(n)} blocs de métadonnées retirés.`,
  nothingRemoved: 'Aucun bloc de métadonnées dans cette image.',
  alreadyClean: `Il n’y a rien à retirer${NB}: le fichier est déjà propre.`,
  download: 'Télécharger l’image nettoyée',
  fileName: (name) => `Nom du fichier${NB}: ${name}`,
  nameTip: `Un nom comme «${NB}ChatGPT Image…${NB}» ou «${NB}ComfyUI_00042_${NB}» trahit lui aussi l’origine de l’image${NB}: renommez-la si besoin.`,
  sizes: (before, after) => `Taille${NB}: ${before} → ${after}`,
  checkSkippedLarge: `Très grande image (plus de 40 mégapixels)${NB}: seule la structure du fichier a été vérifiée, pas l’image décodée.`,
  checkSkippedUndecodable: `Votre navigateur ne sait pas afficher cette image${NB}: seule la structure du fichier a été vérifiée.`,
  previewAlt: 'Aperçu de l’image nettoyée',

  contained: 'Ce que contenait l’image',
  removedTitle: 'Ce qui a été retiré',
  keptTitle: 'Ce qui a été gardé',
  nothingReadable: 'Aucun prompt, réglage de génération, EXIF, XMP ni Content Credentials trouvé.',
  pastedNote:
    'Une image collée perd souvent ses métadonnées en passant par le presse-papiers. Pour vérifier le fichier d’origine, déposez-le ou choisissez-le.',
  secTexts: 'Prompt et réglages de génération',
  secExif: 'EXIF (appareil, logiciel, date, position)',
  secXmp: 'XMP',
  secC2pa: 'Content Credentials (C2PA)',
  secOther: 'Autres données',
  jpegComment: 'Commentaire JPEG',
  hintA1111: 'écrit par AUTOMATIC1111, Forge ou Fooocus',
  hintComfy: 'écrit par ComfyUI',
  hintComfyNodes: (n) => `workflow ComfyUI, ${n === 1 ? '1 nœud' : `${nFr.format(n)} nœuds`}`,
  hintInvoke: 'écrit par InvokeAI',
  hintFooocus: 'écrit par Fooocus',
  chars: (n) => (n === 1 ? '1 caractère' : `${nFr.format(n)} caractères`),
  copy: 'Copier',
  copied: 'Copié',
  copyFailed: `Copie impossible${NB}: le texte est sélectionné, copiez-le à la main.`,
  shownFirst: (n) => `Seuls les ${nFr.format(n)} premiers caractères sont affichés. «${NB}Copier${NB}» prend le texte entier.`,
  fileTruncated: `Le fichier contient plus de texte que PromptWipe n’en lit (5 Mo)${NB}: la suite n’est pas affichée, mais elle est retirée aussi.`,

  exifLabels: {
    ImageDescription: 'Description',
    Make: 'Marque de l’appareil',
    Model: 'Modèle de l’appareil',
    Software: 'Logiciel',
    DateTime: 'Date de modification',
    DateTimeOriginal: 'Date de prise de vue',
    CreateDate: 'Date de création',
    Artist: 'Auteur',
    Copyright: 'Droits d’auteur',
    UserComment: 'Commentaire',
    CameraOwnerName: 'Propriétaire de l’appareil',
    BodySerialNumber: 'Numéro de série de l’appareil',
    LensMake: 'Marque de l’objectif',
    LensModel: 'Modèle de l’objectif',
    ImageUniqueID: 'Identifiant unique de l’image',
    XPTitle: 'Titre (Windows)',
    XPComment: 'Commentaire (Windows)',
    XPAuthor: 'Auteur (Windows)',
    XPKeywords: 'Mots-clés (Windows)',
    XPSubject: 'Sujet (Windows)',
  },
  gps: 'Position GPS',
  gpsUnreadable: 'présente (illisible)',
  makerNote: (size) => `Note du fabricant (MakerNote)${NB}: ${size} de données`,
  thumbnail: (size) => `Miniature intégrée${NB}: ${size}`,

  xmpPacket: (size) => `Paquet XMP${NB}: ${size}`,
  creatorTool: 'Outil de création',
  digitalSourceType: 'Type de source numérique',
  sourceTypes: {
    trainedAlgorithmicMedia: 'Créée par IA générative',
    compositeWithTrainedAlgorithmicMedia: 'Modifiée par IA générative',
    algorithmicMedia: 'Créée par un algorithme',
  },
  description: 'Description',
  credit: 'Crédit',
  provenance: 'Lien vers des Content Credentials',

  c2paSummary: (n, size) => `${n === 1 ? '1 manifeste' : `${nFr.format(n)} manifestes`}, ${size}`,
  c2paGenerator: 'Créé avec',
  c2paSigner: 'Signé par (déclaré, signature non vérifiée)',
  c2paTitle: 'Titre',
  c2paUnreadable: 'Présentes, mais illisibles. Elles sont retirées quand même.',

  trailing: (size) => `${size} de données après la fin de l’image`,
  motionPhoto: `Photo animée (Motion Photo)${NB}: la courte vidéo stockée avec la photo est retirée.`,
  hdrGainMap: `Carte de gain HDR${NB}: retirée. Sur un écran HDR, l’image peut paraître moins lumineuse.`,
  secondaryImages: `Images secondaires (MPF), comme une carte de profondeur${NB}: retirées.`,

  warnings: {
    'text-budget-exceeded': `Ce fichier contient plus de 5 Mo de texte${NB}: seul le début est affiché. Tout est retiré.`,
    'too-many-texts': `Ce fichier contient plus de 1${' '}000 blocs de texte${NB}: seuls les premiers sont affichés. Tous sont retirés.`,
    'compressed-text-unreadable': 'Un bloc compressé est illisible. Il est retiré quand même.',
    'exif-unreadable': 'Le bloc EXIF est illisible. Il est retiré quand même.',
  },

  kinds: {
    text: 'Texte (prompts, réglages, workflows)',
    exif: 'EXIF',
    xmp: 'XMP',
    c2pa: 'Content Credentials (C2PA)',
    iptc: 'IPTC / Photoshop',
    comment: 'Commentaires',
    thumbnail: 'Miniatures',
    'secondary-image': 'Images secondaires',
    trailing: 'Données après la fin de l’image',
    other: 'Autres blocs (dates, résolution, inconnus)',
    image: 'Données d’image',
    color: 'Informations de couleur',
  },
  blockCount: (n) => (n === 1 ? '1 bloc' : `${nFr.format(n)} blocs`),
  allBlocks: 'Tous les blocs, dans l’ordre du fichier',
  actions: { keep: 'gardé', remove: 'retiré', rewrite: 'réécrit' },
  moreBlocks: (n) => `… et ${nFr.format(n)} de plus`,
  keptImage: `L’image elle-même, octet pour octet${NB}: aucun réencodage, aucune perte de qualité`,
  keptAnimation: 'L’animation, image par image',
  keptColor: (name) => `Profil de couleur${NB}: ${name}`,
  keptOrientation: 'La rotation de la photo (orientation EXIF, rien d’autre)',

  errTooLarge: 'Ce fichier dépasse 50 Mo, le maximum que PromptWipe traite.',
  errGif: 'Les images GIF ne sont pas encore prises en charge.',
  errAvif: 'Les images AVIF ne sont pas encore prises en charge.',
  errHeic:
    'Les photos HEIC (le format de l’iPhone) ne sont pas encore prises en charge. Exportez d’abord la photo en JPEG, ou sur l’iPhone choisissez Réglages › Appareil photo › Formats › Le plus compatible.',
  errUnknown: 'Ce fichier n’est pas une image PNG, JPEG ou WebP.',
  requestFormat: 'Demander ce format',
  errMalformed: `Structure de fichier inattendue${NB}: PromptWipe n’a pas pu la lire sans risque, rien n’a été modifié.`,
  errVariant: `Cette image utilise une variante de son format que PromptWipe ne gère pas encore${NB}: rien n’a été modifié.`,
  errVerification: `Le fichier nettoyé n’a pas passé la vérification finale${NB}: il n’est pas proposé. Votre image n’a pas été modifiée. Signalez le problème avec le diagnostic ci-dessous.`,
  errDecode: `Le fichier nettoyé ne s’affiche pas comme l’original${NB}: il n’est pas proposé. Votre image n’a pas été modifiée. Signalez le problème avec le diagnostic ci-dessous.`,
  errRead: 'Le fichier n’a pas pu être lu.',
  errInternal: 'Une erreur est survenue dans PromptWipe. Votre image n’a pas été modifiée. Signalez le problème avec le diagnostic ci-dessous.',
  reportBug: 'Signaler le problème',

  diagTitle: 'Diagnostic pour signaler un problème',
  diagNote: `Il décrit la structure du fichier (format, blocs, tailles), jamais son contenu${NB}: ni prompt, ni texte, ni position.`,
  copyDiag: 'Copier le diagnostic',
};

export const messages: Record<Lang, Messages> = { en, fr };

/**
 * `table[key]` for own entries only. Keys can come from the file (an XMP
 * DigitalSourceType of "constructor" must not find Object.prototype's).
 */
export function lookup(table: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}
