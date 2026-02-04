import mongoose from "mongoose";

const connectDB = async (uri) => {
  try {
    await mongoose.connect(uri);
    console.log("MongoDB conectado");
  } catch (error) {
    console.error("Error conectando a MongoDB", error.message);
    process.exit(1);
  }
};

export default connectDB;
