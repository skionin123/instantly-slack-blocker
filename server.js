import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(express.urlencoded({ extended: true }));

app.post("/slack/blockemail", async (req, res) => {
  const text = req.body.text?.trim();

  if (!text) {
    return res.send("Usage: /blockemail user@example.com");
  }

  const values = text.split(/\s+/);

  try {
    await axios.post(
      "https://api.instantly.ai/api/v2/block-lists-entries/bulk-create",
      {
        bl_values: values
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.INSTANTLY_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.send(`Blocked:\n${values.join("\n")}`);
  } catch (err) {
    console.error(err.response?.data || err.message);

    res.send("Failed to block.");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});

