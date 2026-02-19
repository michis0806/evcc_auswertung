#!/usr/bin/php
<?php
print(date("Y-m-d H:i:s")."\tAbruf wird gestartet\n");
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Style\NumberFormat;

// Autoloader von Composer einbinden
require 'vendor/autoload.php';
Dotenv\Dotenv::createUnsafeImmutable(__DIR__)->load();
setlocale(LC_TIME, 'de_DE.UTF-8');

$cars = $_ENV['cars'];
$stateFile = __DIR__ . '/ladepunkt_state.json';

// State laden (letzter abgerechneter Monat)
$state = [];
if (file_exists($stateFile)) {
	$state = json_decode(file_get_contents($stateFile), true);
}
$lastBilledMonth = $state['last_billed_month'] ?? null;

// Zeitraum bestimmen: vom Monat nach dem letzten abgerechneten bis zum Vormonat
$lastMonth = new DateTime('first day of last month');

if ($lastBilledMonth) {
	$startMonth = new DateTime($lastBilledMonth . '-01');
	$startMonth->modify('+1 month');
} else {
	// Erster Lauf: nur den Vormonat verarbeiten
	$startMonth = clone $lastMonth;
}

// Alle zu verarbeitenden Monate sammeln
$months = [];
$current = clone $startMonth;
while ($current <= $lastMonth) {
	$months[] = clone $current;
	$current->modify('+1 month');
}

if (empty($months)) {
	print(date("Y-m-d H:i:s")."\tKeine neuen Monate zu verarbeiten\n");
	exit(0);
}

print(date("Y-m-d H:i:s")."\tVerarbeite " . count($months) . " Monat(e): " .
	$months[0]->format('Y-m') . " bis " . end($months)->format('Y-m') . "\n");

// Daten fuer alle Monate abrufen
$allCharges = [];
foreach ($months as $month) {
	$url = $_ENV['evcc_url'].	$month->format('n') . '&year=' . $month->format('Y');

	$ch = curl_init();
	curl_setopt($ch, CURLOPT_URL, $url);
	curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
	curl_setopt($ch, CURLOPT_HTTPHEADER, [
		'Accept: application/json'
	]);
	$response = curl_exec($ch);

	if (curl_errno($ch)) {
		print(date("Y-m-d H:i:s")."\tcURL-Fehler fuer " . $month->format('Y-m') . ": " . curl_error($ch) . "\n");
		curl_close($ch);
		continue;
	}
	curl_close($ch);

	$data = json_decode($response, true);
	if (!empty($data)) {
		print(date("Y-m-d H:i:s")."\t" . $month->format('Y-m') . ": " . count($data) . " Ladevorgaenge gefunden\n");
		foreach ($data as $charge) {
			if (!in_array($charge['vehicle'], $cars) || $charge['loadpoint'] != 'Doppelgarage') continue;
			$allCharges[] = $charge;
		}
	} else {
		print(date("Y-m-d H:i:s")."\t" . $month->format('Y-m') . ": Keine Ladevorgaenge\n");
	}
}

// Gesamtkosten berechnen
$totalEnergy = 0.0;
$totalPrice = 0.0;
foreach ($allCharges as $charge) {
	$totalEnergy += round($charge['chargedEnergy'], 2);
	$totalPrice += round($charge['price'], 2);
}

print(date("Y-m-d H:i:s")."\t" . count($allCharges) . " relevante Ladevorgaenge, Gesamtkosten: " .
	number_format($totalPrice, 2, ',', '') . " EUR\n");

print(date("Y-m-d H:i:s")."\tExcel wird erstellt und Mail verschickt.\n");

// Excel erstellen
$firstMonthStr = $months[0]->format('Y-m');
$lastMonthStr = end($months)->format('Y-m');
if ($firstMonthStr === $lastMonthStr) {
	$xlsxFile = '/tmp/charging_' . $firstMonthStr . '.xlsx';
} else {
	$xlsxFile = '/tmp/charging_' . $firstMonthStr . '_' . $lastMonthStr . '.xlsx';
}

$spreadsheet = new Spreadsheet();
$sheet = $spreadsheet->getActiveSheet();
$sheet->setTitle('Ladevorgänge');

// Titelzeile (merged ueber alle Spalten)
$sheet->setCellValue('A1', 'Ladevorgänge ID.BUZZ - OA-FX25E');
$sheet->mergeCells('A1:F1');
$sheet->getStyle('A1')->getFont()->setBold(true)->setSize(14);
$sheet->getStyle('A1')->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);

// Kopfzeile
$headers = ['Beginn', 'Ende', 'Kilometerstand', 'Geladene Energie (kWh)', 'EUR/kWh', 'Kosten (EUR)'];
$sheet->fromArray($headers, null, 'A2');
$sheet->getStyle('A2:F2')->getFont()->setBold(true);

$row = 3;
$monthFmt = new IntlDateFormatter('de_DE', IntlDateFormatter::NONE, IntlDateFormatter::NONE, 'Europe/Berlin', null, 'MMMM yyyy');
$dateFormat = 'dd.mm.yyyy hh:mm';
$numFormat = '#,##0.00';
$monthSumRows = [];

// Ladevorgaenge nach Monat gruppieren
$chargesByMonth = [];
foreach ($allCharges as $charge) {
	$monthKey = date('Y-m', strtotime($charge['created']));
	$chargesByMonth[$monthKey][] = $charge;
}

foreach ($chargesByMonth as $monthKey => $monthCharges) {
	$monthStartRow = $row;

	foreach ($monthCharges as $charge) {
		$created = new DateTime($charge['created']);
		$finished = new DateTime($charge['finished']);

		$sheet->setCellValue("A{$row}", \PhpOffice\PhpSpreadsheet\Shared\Date::PHPToExcel($created));
		$sheet->setCellValue("B{$row}", \PhpOffice\PhpSpreadsheet\Shared\Date::PHPToExcel($finished));
		if (!is_null($charge['odometer'])) {
			$sheet->setCellValue("C{$row}", (int)$charge['odometer']);
		}
		$sheet->setCellValue("D{$row}", round($charge['chargedEnergy'], 2));
		$sheet->setCellValue("E{$row}", round($charge['pricePerKWh'], 2));
		$sheet->setCellValue("F{$row}", round($charge['price'], 2));

		$sheet->getStyle("A{$row}:B{$row}")->getNumberFormat()->setFormatCode($dateFormat);
		$sheet->getStyle("D{$row}:F{$row}")->getNumberFormat()->setFormatCode($numFormat);
		$row++;
	}
	$monthLastRow = $row - 1;

	// Monatssumme mit Formeln
	$monthLabel = $monthFmt->format(new DateTime($monthKey . '-01'));
	$sheet->setCellValue("C{$row}", 'Summe ' . $monthLabel);
	$sheet->setCellValue("D{$row}", "=SUM(D{$monthStartRow}:D{$monthLastRow})");
	$sheet->setCellValue("E{$row}", "=IF(D{$row}<>0,F{$row}/D{$row},0)");
	$sheet->setCellValue("F{$row}", "=SUM(F{$monthStartRow}:F{$monthLastRow})");

	$sheet->getStyle("D{$row}:F{$row}")->getNumberFormat()->setFormatCode($numFormat);
	$sheet->getStyle("A{$row}:F{$row}")->getFont()->setBold(true);
	$sheet->getStyle("A{$row}:F{$row}")->getFill()
		->setFillType(Fill::FILL_SOLID)
		->getStartColor()->setRGB('D9E1F2');

	$monthSumRows[] = $row;
	$row++;
}

// Gesamtsumme mit Formeln (Summe der Monatssummen)
$sheet->setCellValue("C{$row}", 'GESAMTSUMME');
if (count($monthSumRows) === 1) {
	$sheet->setCellValue("D{$row}", "=D{$monthSumRows[0]}");
	$sheet->setCellValue("F{$row}", "=F{$monthSumRows[0]}");
} else {
	$sumRefs_D = implode(',', array_map(fn($r) => "D{$r}", $monthSumRows));
	$sumRefs_F = implode(',', array_map(fn($r) => "F{$r}", $monthSumRows));
	$sheet->setCellValue("D{$row}", "=SUM({$sumRefs_D})");
	$sheet->setCellValue("F{$row}", "=SUM({$sumRefs_F})");
}
$sheet->setCellValue("E{$row}", "=IF(D{$row}<>0,F{$row}/D{$row},0)");

$sheet->getStyle("D{$row}:F{$row}")->getNumberFormat()->setFormatCode($numFormat);
$sheet->getStyle("A{$row}:F{$row}")->getFont()->setBold(true);
$sheet->getStyle("A{$row}:F{$row}")->getFill()
	->setFillType(Fill::FILL_SOLID)
	->getStartColor()->setRGB('B4C6E7');

// Spaltenbreiten anpassen
foreach (range('A', 'F') as $col) {
	$sheet->getColumnDimension($col)->setAutoSize(true);
}

$writer = new Xlsx($spreadsheet);
$writer->save($xlsxFile);

print(date("Y-m-d H:i:s")."\t" . count($allCharges) . " relevante Ladevorgaenge in Excel geschrieben\n");

// Mail versenden
$mail = new PHPMailer(true);
$mail->CharSet = 'UTF-8';

try {
	$mail->isSMTP();
	$mail->Host       = getenv('SMTP_HOST');
	$mail->SMTPAuth   = true;
	$mail->Username   = getenv('SMTP_USERNAME_EVCC');
	$mail->Password   = getenv('SMTP_PASSWORD_EVCC');
	$mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
	$mail->Port       = (int)getenv('SMTP_PORT');

	$mail->setFrom(getenv('LADEPUNKT_FROM'), 'Ladebericht');

	// Dezember ist immer eine volle Abrechnung (Jahreswechsel)
	$includesDecember = false;
	foreach ($months as $m) {
		if ((int)$m->format('n') === 12) { $includesDecember = true; break; }
	}
	$fullBilling = $totalPrice >= 25 || $includesDecember;

	// Volle Abrechnung: Hauptempfänger mit Excel-Anhang
	// Sonst: monatliche Empfänger ohne Excel-Anhang
	if ($fullBilling) {
		$recipientVar = 'LADEPUNKT_RECIPIENTS';
	} else {
		$recipientVar = 'LADEPUNKT_RECIPIENTS_MONTHLY';
	}
	foreach (explode(',', getenv($recipientVar)) as $addr) {
		$mail->addAddress(trim($addr));
	}

	$mail->isHTML(true);
	$fmt = new IntlDateFormatter('de_DE', IntlDateFormatter::NONE, IntlDateFormatter::NONE, 'Europe/Berlin', null, 'MMMM yyyy');
	$dateFmt = new IntlDateFormatter('de_DE', IntlDateFormatter::NONE, IntlDateFormatter::NONE, 'Europe/Berlin', null, 'dd.MM.yyyy HH:mm');

	if (count($months) === 1) {
		$periodLabel = $fmt->format($months[0]);
	} else {
		$periodLabel = $fmt->format($months[0]) . ' bis ' . $fmt->format(end($months));
	}

	$mail->Subject = 'Ladevorgänge zuhause ID.BUZZ OA-FX25E vom ' . $periodLabel;
	if ($fullBilling) {
		$mail->addAttachment($xlsxFile);
	}

	// HTML-Tabelle aufbauen
	$tableRows = '';
	foreach ($chargesByMonth as $monthKey => $monthCharges) {
		$mEnergy = 0.0;
		$mPrice = 0.0;
		foreach ($monthCharges as $charge) {
			$created = new DateTime($charge['created']);
			$finished = new DateTime($charge['finished']);
			$odometer = is_null($charge['odometer']) ? '' : number_format((int)$charge['odometer'], 0, ',', '.');
			$energy = round($charge['chargedEnergy'], 2);
			$price = round($charge['price'], 2);
			$mEnergy += $energy;
			$mPrice += $price;

			$tableRows .= '<tr>'
				. '<td style="padding:6px 10px;border-bottom:1px solid #e0e0e0;">' . $dateFmt->format($created) . '</td>'
				. '<td style="padding:6px 10px;border-bottom:1px solid #e0e0e0;">' . $dateFmt->format($finished) . '</td>'
				. '<td style="padding:6px 10px;border-bottom:1px solid #e0e0e0;text-align:right;">' . $odometer . '</td>'
				. '<td style="padding:6px 10px;border-bottom:1px solid #e0e0e0;text-align:right;">' . number_format($energy, 2, ',', '') . '</td>'
				. '<td style="padding:6px 10px;border-bottom:1px solid #e0e0e0;text-align:right;">' . number_format($charge['pricePerKWh'], 2, ',', '') . '</td>'
				. '<td style="padding:6px 10px;border-bottom:1px solid #e0e0e0;text-align:right;">' . number_format($price, 2, ',', '') . '</td>'
				. '</tr>';
		}
		$mAvg = $mEnergy > 0 ? $mPrice / $mEnergy : 0;
		$mLabel = $fmt->format(new DateTime($monthKey . '-01'));
		$tableRows .= '<tr style="background-color:#D9E1F2;font-weight:bold;">'
			. '<td colspan="3" style="padding:6px 10px;">Summe ' . $mLabel . '</td>'
			. '<td style="padding:6px 10px;text-align:right;">' . number_format($mEnergy, 2, ',', '') . '</td>'
			. '<td style="padding:6px 10px;text-align:right;">' . number_format($mAvg, 2, ',', '') . '</td>'
			. '<td style="padding:6px 10px;text-align:right;">' . number_format($mPrice, 2, ',', '') . '</td>'
			. '</tr>';
	}

	$avgPrice = $totalEnergy > 0 ? $totalPrice / $totalEnergy : 0;
	$tableRows .= '<tr style="background-color:#B4C6E7;font-weight:bold;">'
		. '<td colspan="3" style="padding:6px 10px;">GESAMTSUMME</td>'
		. '<td style="padding:6px 10px;text-align:right;">' . number_format($totalEnergy, 2, ',', '') . '</td>'
		. '<td style="padding:6px 10px;text-align:right;">' . number_format($avgPrice, 2, ',', '') . '</td>'
		. '<td style="padding:6px 10px;text-align:right;">' . number_format($totalPrice, 2, ',', '') . '</td>'
		. '</tr>';

	$mail->Body = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;color:#333;margin:0;padding:20px;background-color:#f5f5f5;">'
		. '<div style="max-width:800px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">'
		. '<div style="background-color:#1a3a5c;color:#fff;padding:20px 24px;">'
		. '<h2 style="margin:0;font-size:20px;">Ladevorg&auml;nge ID.BUZZ &ndash; OA-FX25E</h2>'
		. '<p style="margin:6px 0 0;font-size:14px;opacity:0.85;">' . htmlspecialchars($periodLabel) . '</p>'
		. '</div>'
		. '<div style="padding:24px;">'
		. '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">'
		. '<thead><tr style="background-color:#f0f0f0;">'
		. '<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #1a3a5c;">Beginn</th>'
		. '<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #1a3a5c;">Ende</th>'
		. '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid #1a3a5c;">km-Stand</th>'
		. '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid #1a3a5c;">kWh</th>'
		. '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid #1a3a5c;">EUR/kWh</th>'
		. '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid #1a3a5c;">Kosten</th>'
		. '</tr></thead>'
		. '<tbody>' . $tableRows . '</tbody>'
		. '</table>'
		. ($fullBilling ? '<p style="margin:20px 0 0;font-size:12px;color:#888;">Die vollst&auml;ndige Aufstellung ist als Excel-Datei angeh&auml;ngt.</p>' : '')
		. '</div></div></body></html>';

	$mail->AltBody = "Ladevorgänge ID.BUZZ - OA-FX25E\n" . $periodLabel . "\n\n"
		. "Gesamtverbrauch: " . number_format($totalEnergy, 2, ',', '') . " kWh\n"
		. "Durchschnittspreis: " . number_format($avgPrice, 2, ',', '') . " EUR/kWh\n"
		. "Gesamtkosten: " . number_format($totalPrice, 2, ',', '') . " EUR"
		. ($fullBilling ? "\n\nDetails siehe Excel-Anhang." : "");

	$mail->send();
	print(date("Y-m-d H:i:s")."\tE-Mail wurde erfolgreich verschickt.\n");

	// State aktualisieren - Marker auf den letzten verarbeiteten Monat setzen
	$state['last_billed_month'] = end($months)->format('Y-m');
	file_put_contents($stateFile, json_encode($state, JSON_PRETTY_PRINT));
	print(date("Y-m-d H:i:s")."\tMarker auf " . $state['last_billed_month'] . " gesetzt.\n");

} catch (Exception $e) {
	print(date("Y-m-d H:i:s")."\tE-Mail konnte nicht verschickt werden: {$mail->ErrorInfo}\n");
}
?>
