import { s3Client } from "../services/aws/aws.config.js";
import { ListBucketsCommand } from "@aws-sdk/client-s3";
import { storageService } from "../services/storage/s3.service.js";
import crypto from "crypto";

async function main() {
  console.log("🔍 Checking AWS S3 Configuration...");

  try {
    // 1. Check Credentials
    console.log("1️⃣  Verifying Credentials (ListBuckets)...");
    const data = await s3Client.send(new ListBucketsCommand({}));
    console.log("✅ Credentials Valid. Buckets found:", data.Buckets?.length);

    // 2. Generate Presigned URL (Temp Key)
    console.log("2️⃣  Generating Presigned URL...");
    const content = "Hello S3 World!";
    const checksum = crypto.createHash("md5").update(content).digest("hex");

    // Simulate Controller Logic: Prefix with temp/
    // TEST_FILE purpose maps to "test-files" folder
    const tempKey = `temp/test-files/test-${Date.now()}.txt`;

    const { url, key } = await storageService.getPresignedUploadUrl(
      "", // Prefix already in key
      tempKey,
      "text/plain",
      content.length,
      checksum,
    );
    console.log("✅ Generated URL:", url);
    console.log("temp_key:", key);

    // 3. Perform Upload
    console.log("\n3️⃣  Uploading file to S3 (temp)...");
    const uploadRes = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "text/plain",
      },
      body: content,
    });

    if (uploadRes.ok) {
      console.log("✅ Upload Successful! Status:", uploadRes.status);

      // 4. Confirm Move (Simulate Backend Confirm)
      console.log("\n4️⃣  Moving to Permanent Storage (Simulated Confirm)...");

      // Verify temp integrity
      const tempMetadata = await storageService.checkExists(key);
      if (tempMetadata.etag !== checksum) {
        console.error("❌ Integrity Check Failed!");
        process.exit(1);
      }

      // Perform Move
      const finalKey = key.replace("temp/", "");
      console.log("Moving to:", finalKey);
      await storageService.move(key, finalKey);
      console.log("✅ Move Successful!");

      // Verify Final
      console.log("\n5️⃣  Verifying Final File (Exists)...");
      await storageService.checkExists(finalKey);

      // 6. Test Download URL
      console.log("\n6️⃣  Generating Private Download URL...");
      const downloadUrl =
        await storageService.getPresignedDownloadUrl(finalKey);
      console.log("🔗 Signed URL:", downloadUrl);

      console.log("Trying to fetch file via Signed URL...");
      const downloadRes = await fetch(downloadUrl);
      if (downloadRes.ok) {
        console.log("✅ Download Successful! Status:", downloadRes.status);
        const text = await downloadRes.text();
        console.log("📄 Content:", text);
        if (text === content) {
          console.log("✅ Content Match!");
        } else {
          console.error("❌ Content Mismatch!");
        }
      } else {
        console.error("❌ Download Failed! Status:", downloadRes.status);
      }

      // Cleanup
      console.log("\n🧹 Cleaning up...");
      await storageService.delete(finalKey);
      console.log("✅ Cleanup done.");
    } else {
      console.error("❌ Upload Failed! Status:", uploadRes.status);
      console.error("Response:", await uploadRes.text());
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
