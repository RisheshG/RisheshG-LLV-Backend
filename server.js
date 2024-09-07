const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: 'uploads/' });

// Ensure the uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Validate email syntax
const validateEmailSyntax = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

// Check MX records for the domain
const checkMxRecords = (domain) => {
  return new Promise((resolve) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err || addresses.length === 0) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
};

// Simulate SMTP validation
const verifySmtp = (email) => {
  const domain = email.split('@')[1];
  return checkMxRecords(domain).then((hasMxRecords) => {
    if (!hasMxRecords) {
      return 'invalid';
    }
    if (domain.endsWith(".com")) {
      return 'valid';
    } else if (domain.endsWith(".org")) {
      return 'catchall';
    } else {
      return 'invalid';
    }
  });
};

// Verify email
const verifyEmail = async (email) => {
  if (!validateEmailSyntax(email)) {
    return 'invalid';
  }

  const smtpStatus = await verifySmtp(email);
  return smtpStatus;
};

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const filePath = req.file.path;
    const emailColumn = req.body.emailColumn;
    const originalFileName = path.parse(req.file.originalname).name;

    if (!filePath || !emailColumn) {
      return res.status(400).json({ status: 'error', message: 'File or email column is missing' });
    }

    const validResults = [];
    const invalidResults = [];
    const catchAllResults = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', async (data) => {
        const email = data[emailColumn];
        if (email) {
          try {
            const status = await verifyEmail(email);
            const resultData = { ...data, status };
            if (status === 'valid') validResults.push(resultData);
            else if (status === 'invalid') invalidResults.push(resultData);
            else catchAllResults.push(resultData);
          } catch (error) {
            invalidResults.push({ ...data, status: 'invalid' });
          }
        } else {
          invalidResults.push({ ...data, status: 'invalid' });
        }
      })
      .on('end', () => {
        const validOutputPath = path.join(__dirname, 'uploads', `${originalFileName}-valid.csv`);
        const invalidOutputPath = path.join(__dirname, 'uploads', `${originalFileName}-invalid.csv`);
        const catchAllOutputPath = path.join(__dirname, 'uploads', `${originalFileName}-catchall.csv`);

        const writeCsvFile = (outputPath, results) => {
          if (results.length > 0) {
            const writeStream = fs.createWriteStream(outputPath);
            writeStream.write(Object.keys(results[0]).join(',') + '\n');
            results.forEach((result) => writeStream.write(Object.values(result).join(',') + '\n'));
            writeStream.end();
          }
        };

        writeCsvFile(validOutputPath, validResults);
        writeCsvFile(invalidOutputPath, invalidResults);
        writeCsvFile(catchAllOutputPath, catchAllResults);

        const validDownloadUrl = `https://risheshg-llv-backend-production.up.railway.app/download/${originalFileName}-valid.csv`;
        const invalidDownloadUrl = `https://risheshg-llv-backend-production.up.railway.app/download/${originalFileName}-invalid.csv`;
        const catchAllDownloadUrl = `https://risheshg-llv-backend-production.up.railway.app/download/${originalFileName}-catchall.csv`;

        res.json({
          validCount: validResults.length,
          invalidCount: invalidResults.length,
          catchAllCount: catchAllResults.length,
          validUrl: validDownloadUrl,
          invalidUrl: invalidDownloadUrl,
          catchAllUrl: catchAllDownloadUrl,
        });

        fs.unlinkSync(filePath);
      })
      .on('error', (err) => {
        console.error('Error processing CSV file:', err);
        res.status(500).json({ status: 'error', message: 'Error processing CSV file' });
      });
  } catch (error) {
    console.error('Error handling upload request:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});


// Static file serving for downloads
app.use('/download', express.static(uploadsDir));

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
