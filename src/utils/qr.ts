import QRCode from 'qrcode';

// 자체 QR PNG 렌더링 (외부 QR 이미지 서비스 의존 제거용)
export async function generateQRPngBuffer(data: string, size = 600): Promise<Buffer> {
    return QRCode.toBuffer(data, {
        errorCorrectionLevel: 'H',
        type: 'png',
        width: size,
        margin: 2,
    });
}

export async function generateQRCodeHTML(code: string): Promise<string> {
    const dataUrl = await QRCode.toDataURL(code, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        width: 1000,
        margin: 2,
    });

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QR Code</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            width: 100vw;
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            background: white;
        }
        img {
            max-width: 90vw;
            max-height: 90vh;
            object-fit: contain;
        }
    </style>
</head>
<body>
    <img src="${dataUrl}" alt="QR Code" />
</body>
</html>`;
}
