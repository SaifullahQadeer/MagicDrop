import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  validateMagicLink,
  recordDownload,
} from "../services/magic-link.server";
import { getPresignedDownloadUrl } from "../services/s3.server";

export const loader = async ({ request, params }) => {
  const { token } = params;
  const { valid, error, magicLink } = await validateMagicLink(token);

  if (!valid) {
    return json({ valid: false, error });
  }

  return json({
    valid: true,
    fileName: magicLink.file.originalName,
    fileSize: magicLink.file.fileSize,
    downloadsRemaining: magicLink.maxDownloads - magicLink.downloadCount,
    expiresAt: magicLink.expiresAt,
    token,
  });
};

export const action = async ({ request, params }) => {
  const { token } = params;
  const { valid, error, magicLink } = await validateMagicLink(token);

  if (!valid) {
    return json({ error }, { status: 403 });
  }

  // Record the download
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip");
  const userAgent = request.headers.get("user-agent");
  await recordDownload(magicLink.id, ip, userAgent);

  // Generate presigned S3 URL and redirect to it
  const downloadUrl = await getPresignedDownloadUrl(
    magicLink.file.s3Key,
    magicLink.file.s3Bucket,
    300 // 5 minutes
  );

  return redirect(downloadUrl);
};

export default function DownloadPage() {
  const data = useLoaderData();

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!data.valid) {
    return (
      <html>
        <head>
          <meta charSet="utf-8" />
          <meta
            name="viewport"
            content="width=device-width,initial-scale=1"
          />
          <title>Download Unavailable - MagicDrop</title>
          <style
            dangerouslySetInnerHTML={{
              __html: `
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
            .container { max-width: 480px; padding: 20px; text-align: center; }
            .card { background: white; border-radius: 16px; padding: 48px 32px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
            .icon { font-size: 48px; margin-bottom: 16px; }
            h1 { font-size: 22px; color: #111827; margin-bottom: 8px; }
            p { font-size: 15px; color: #6b7280; line-height: 1.6; }
          `,
            }}
          />
        </head>
        <body>
          <div className="container">
            <div className="card">
              <div className="icon">&#128274;</div>
              <h1>Download Unavailable</h1>
              <p>{data.error}</p>
              <p style={{ marginTop: "16px", fontSize: "13px" }}>
                If you believe this is a mistake, please contact the seller.
              </p>
            </div>
          </div>
        </body>
      </html>
    );
  }

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Download Your File - MagicDrop</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
          .container { max-width: 480px; padding: 20px; width: 100%; }
          .card { background: white; border-radius: 16px; padding: 48px 32px; box-shadow: 0 1px 3px rgba(0,0,0,.1); text-align: center; }
          .brand { color: #5C6AC4; font-size: 14px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 24px; }
          .icon { font-size: 48px; margin-bottom: 16px; }
          h1 { font-size: 22px; color: #111827; margin-bottom: 4px; }
          .meta { font-size: 14px; color: #6b7280; margin-bottom: 24px; }
          .btn { display: inline-block; padding: 14px 48px; background: #5C6AC4; color: white; text-decoration: none; border-radius: 10px; font-size: 16px; font-weight: 600; border: none; cursor: pointer; transition: background 0.2s; }
          .btn:hover { background: #4959bd; }
          .info { margin-top: 24px; font-size: 13px; color: #9ca3af; line-height: 1.6; }
        `,
          }}
        />
      </head>
      <body>
        <div className="container">
          <div className="card">
            <div className="brand">MagicDrop</div>
            <div className="icon">&#128230;</div>
            <h1>{data.fileName}</h1>
            <p className="meta">{formatFileSize(data.fileSize)}</p>
            <form method="post">
              <button type="submit" className="btn">
                Download File
              </button>
            </form>
            <p className="info">
              {data.downloadsRemaining} download
              {data.downloadsRemaining !== 1 ? "s" : ""} remaining
              <br />
              Link expires{" "}
              {new Date(data.expiresAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
