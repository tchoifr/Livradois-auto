<?php
declare(strict_types=1);

// Le dashboard est publié avec le site (GitHub Pages) : on y redirige.
require __DIR__ . '/lib/bootstrap.php';
header('Location: ' . cfg('site_url', '/') . 'admin/', true, 302);
