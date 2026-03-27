import os
import uuid
import PyPDF2
import json
from flask import Flask, request, Response, stream_with_context, render_template
from flask_cors import CORS
import chromadb
from chromadb.utils import embedding_functions
from dotenv import load_dotenv
from google import genai
from google.genai import types

# 1. Load the .env file
load_dotenv()

app = Flask(__name__)
CORS(app)

api_key = os.environ.get("GEMINI_API_KEY")

client_gemini = genai.Client(
    api_key=api_key,
    http_options=types.HttpOptions(api_version='v1')
)
MODEL_ID = "gemini-2.5-flash"

CHROMA_PATH = "./chroma_db"
os.makedirs(CHROMA_PATH, exist_ok=True)
os.makedirs('./pdfs/', exist_ok=True)

local_ef = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")
db_client = chromadb.PersistentClient(path=CHROMA_PATH)
collection = db_client.get_or_create_collection(name="bot_kb", embedding_function=local_ef)

class PDFKnowledgeBase:
    def extract_and_chunk(self, pdf_path, chunk_size=1000):
        text = ""
        try:
            with open(pdf_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                for page in reader.pages:
                    content = page.extract_text()
                    if content:
                        text += content + " "
            return [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
        except Exception as e:
            print(f" Extraction Error: {e}")
            return []

    def add_pdf(self, pdf_path):
        chunks = self.extract_and_chunk(pdf_path)
        if chunks:
            ids = [str(uuid.uuid4()) for _ in chunks]
            collection.add(documents=chunks, ids=ids)
            print(f" Added {len(chunks)} chunks to ChromaDB.")

    def search(self, query, n_results=3):
        results = collection.query(query_texts=[query], n_results=n_results)
        return results['documents'][0] if results['documents'] else []

kb = PDFKnowledgeBase()
PDF_FILE = "./pdfs/EmpVerify_Customer_Support.pdf"

if os.path.exists(PDF_FILE) and collection.count() == 0:
    kb.add_pdf(PDF_FILE)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    message = data.get('message')
    
    def generate():
        try:
            context_results = kb.search(message)
            context_text = "\n".join(context_results)
            
            prompt = f"""
            You are a professional customer support assistant for Agregar Technologies. 
            Use the following context to answer the user's question directly.

            RULES:
            - Do NOT mention "the document", "the text", or "Section X".
            - Do NOT start with "According to..." or "Based on the information...".
            - Answer as if you naturally know this information.
            - If the context doesn't contain the answer, say you don't have that information.

            Context:
            {context_text}

            Question: {message}
            """
            
            response = client_gemini.models.generate_content_stream(
                model=MODEL_ID,
                contents=prompt
            )

            for chunk in response:
                if chunk.text:
                    yield f"data: {json.dumps({'message': chunk.text})}\n\n"
                    
        except Exception as e:
            yield f"data: {json.dumps({'message': f'Error: {str(e)}'})}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')

if __name__ == '__main__':
    app.run(port=5000, debug=True)
