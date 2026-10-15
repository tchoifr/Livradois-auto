<?php
declare(strict_types=1);

/**
 * Photos des annonces : contrôle du fichier, recadrage 3:2 et conversion WebP (GD).
 * Deux tailles : 1200x800 (fiche) et 600x400 (vignettes).
 */
final class Uploads
{
    private const MAX_BYTES = 15 * 1024 * 1024;
    private const DIR = '/uploads/vehicules';

    public static function photo(array $file): array
    {
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
            Http::fail(422, 'Envoi du fichier impossible (taille maximale : 15 Mo).');
        }
        if ($file['size'] > self::MAX_BYTES) {
            Http::fail(422, 'Image trop lourde (15 Mo maximum).');
        }
        $info = @getimagesize($file['tmp_name']);
        $mime = $info['mime'] ?? '';
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            Http::fail(422, 'Format non pris en charge : utilisez JPG, PNG ou WebP.');
        }
        if ($info[0] * $info[1] > 40_000_000) {
            Http::fail(422, 'Image trop grande (40 mégapixels maximum).');
        }

        $src = match ($mime) {
            'image/jpeg' => @imagecreatefromjpeg($file['tmp_name']),
            'image/png' => @imagecreatefrompng($file['tmp_name']),
            'image/webp' => @imagecreatefromwebp($file['tmp_name']),
        };
        if (!$src) {
            Http::fail(422, 'Image illisible.');
        }
        if ($mime === 'image/jpeg' && function_exists('exif_read_data')) {
            $src = self::orient($src, (int) (@exif_read_data($file['tmp_name'])['Orientation'] ?? 1));
        }

        $dir = BO_ROOT . self::DIR;
        if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
            Http::fail(500, 'Dossier de photos inaccessible.');
        }
        $name = date('Ymd') . '-' . bin2hex(random_bytes(8));
        $ext = function_exists('imagewebp') ? 'webp' : 'jpg';
        foreach ([['', 1200, 800], ['-sm', 600, 400]] as [$suffix, $w, $h]) {
            $out = self::cover($src, $w, $h);
            $path = "$dir/$name$suffix.$ext";
            $ok = $ext === 'webp' ? imagewebp($out, $path, 80) : imagejpeg($out, $path, 82);
            imagedestroy($out);
            if (!$ok) {
                Http::fail(500, 'Enregistrement de la photo impossible.');
            }
        }
        imagedestroy($src);

        $base = rtrim((string) cfg('backoffice_url', ''), '/') . self::DIR;
        return ['url' => "$base/$name.$ext", 'urlSmall' => "$base/$name-sm.$ext"];
    }

    /** Supprime les fichiers d'une photo si elle est hébergée ici. */
    public static function deleteLocal(array $photo): void
    {
        foreach (['url', 'urlSmall'] as $k) {
            if (empty($photo[$k]) || !preg_match('#/uploads/vehicules/([A-Za-z0-9-]+\.(webp|jpg))$#', $photo[$k], $m)) {
                continue;
            }
            $path = BO_ROOT . self::DIR . '/' . $m[1];
            if (is_file($path)) {
                @unlink($path);
            }
        }
    }

    private static function cover($src, int $w, int $h)
    {
        $sw = imagesx($src);
        $sh = imagesy($src);
        $scale = max($w / $sw, $h / $sh);
        $cw = (int) round($w / $scale);
        $ch = (int) round($h / $scale);
        $out = imagecreatetruecolor($w, $h);
        imagecopyresampled($out, $src, 0, 0, (int) (($sw - $cw) / 2), (int) (($sh - $ch) / 2), $w, $h, $cw, $ch);
        return $out;
    }

    private static function orient($img, int $o)
    {
        return match ($o) {
            3 => imagerotate($img, 180, 0),
            6 => imagerotate($img, -90, 0),
            8 => imagerotate($img, 90, 0),
            default => $img,
        };
    }
}
