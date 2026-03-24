from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from flask_session import Session
import uuid
import re
import random
from datetime import datetime
import os
import numpy as np
import pickle
import PyPDF2
from sentence_transformers import SentenceTransformer
import faiss
import requests
import json
import traceback

# For the local librariees
import nltk
from nltk.tokenize import word_tokenize
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer
import spacy

# Initializing the flask app
app = Flask(__name__, 
            static_folder='static',
            template_folder='templates')

app.config['SECRET_KEY'] = os.urandom(24)
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_PERMANENT'] = False
app.config['SESSION_USE_SIGNER'] = True
app.config['SESSION_FILE_DIR'] = './flask_session/'

# Create necessary directories
os.makedirs('./flask_session/', exist_ok=True)
os.makedirs('./knowledge_base/', exist_ok=True)
os.makedirs('./pdfs/', exist_ok=True)

# Initialize extensions
CORS(app, supports_credentials=True)
Session(app)

# Add CSP headers
@app.after_request
def add_csp_headers(response):
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
        "font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; "
        "img-src 'self' data: https:; " 
        "connect-src 'self' http://localhost:5000 http://localhost:11434; "
    )
    return response



# Initialize NLP tools
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    os.system("python -m spacy download en_core_web_sm")
    nlp = spacy.load("en_core_web_sm")

try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')
    nltk.download('stopwords')
    nltk.download('wordnet')

lemmatizer = WordNetLemmatizer()
stop_words = set(stopwords.words('english'))

# ---  LOADING the model ---
try:
    print("⏳ Loading embedding model (this requires internet on first run)...")
    embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
    print(" Embedding model loaded successfully.")
except Exception as e:
    print("\n CRITICAL ERROR: Could not load the embedding model.")
    print(f"Details: {e}")
    print("\nFIX: Please check your internet connection. The first run needs to download ~80MB from HuggingFace.")
    print("If you are offline, ensure the model is already in your local cache.")
    embedding_model = None 

# In-memory storage
sessions_data = {}

class PDFKnowledgeBase:
    def __init__(self, pdf_folder='./pdfs/', kb_file='./knowledge_base/kb.pkl'):
        self.pdf_folder = pdf_folder
        self.kb_file = kb_file
        self.chunks = []
        self.embeddings = None
        self.index = None
        
        # Only initializes if the model loaded correctly
        if embedding_model:
            self.load_or_create_knowledge_base()
        else:
            print(" Skipping KB initialization because embedding_model is missing.")
        
    def extract_text_from_pdf(self, pdf_path):
        print(f"\n📄 Attempting to extract text from: {pdf_path}")
        text = ""
        if not os.path.exists(pdf_path):
            print(f" ERROR: File does not exist: {pdf_path}")
            return ""
        
        try:
            with open(pdf_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                for page in pdf_reader.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
        except Exception as e:
            print(f"Error extracting text: {str(e)}")
            return ""
        return text
    
    def chunk_text(self, text, chunk_size=500, overlap=50):
        if not text: return []
        words = text.split()
        chunks = []
        for i in range(0, len(words), chunk_size - overlap):
            chunk = ' '.join(words[i:i + chunk_size])
            if chunk:
                chunks.append(chunk)
        return chunks

    def load_knowledge_base(self):
        if os.path.exists(self.kb_file):
            try:
                with open(self.kb_file, 'rb') as f:
                    data = pickle.load(f)
                self.chunks = data['chunks']
                self.embeddings = data['embeddings']
                if len(self.embeddings) > 0:
                    dimension = self.embeddings.shape[1]
                    self.index = faiss.IndexFlatL2(dimension)
                    self.index.add(self.embeddings.astype('float32'))
                return True
            except Exception:
                return False
        return False
    
    def load_or_create_knowledge_base(self):
        if self.load_knowledge_base():
            print(" Using existing knowledge base.")
            return
        
        # ---  ---
        base_dir = os.path.dirname(os.path.abspath(__file__))
        pdf_path = os.path.join(base_dir, 'pdfs', 'EmpVerify_Customer_Support.pdf')
        
        if not os.path.exists(pdf_path):
            print(f" PDF not found at {pdf_path}. Please place your PDF in the /pdfs/ folder.")
            return

        print(f"Processing PDF: {pdf_path}")
        text = self.extract_text_from_pdf(pdf_path)
        raw_chunks = self.chunk_text(text)
        
        if raw_chunks:
            self.chunks = [{'source': 'EmpVerify_Customer_Support.pdf', 'text': c} for c in raw_chunks]
            texts = [c['text'] for c in self.chunks]
            self.embeddings = embedding_model.encode(texts, show_progress_bar=True)
            
            dimension = self.embeddings.shape[1]
            self.index = faiss.IndexFlatL2(dimension)
            self.index.add(self.embeddings.astype('float32'))
            
            with open(self.kb_file, 'wb') as f:
                pickle.dump({'chunks': self.chunks, 'embeddings': self.embeddings}, f)
            print("Knowledge base created and saved.")

    def search(self, query, top_k=5):
        if not self.index or not embedding_model:
            return []
        query_embedding = embedding_model.encode([query])
        distances, indices = self.index.search(query_embedding.astype('float32'), top_k)
        results = []
        for i, idx in enumerate(indices[0]):
            if idx < len(self.chunks):
                results.append({'chunk': self.chunks[idx], 'relevance': 1/(1+distances[0][i])})
        return results

class Llama3Local:
    def __init__(self, model_name="llama3.2"):
        self.model_name = model_name
        self.ollama_url = "http://localhost:11434"
    
    def generate(self, prompt, system_prompt=None):
        try:
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
            
            response = requests.post(
                f"{self.ollama_url}/api/chat",
                json={"model": self.model_name, "messages": messages, "stream": False},
                timeout=180
            )
            return response.json().get('message', {}).get('content', "No response.")
        except Exception as e:
            return f"LLM Error: {str(e)}"

class LocalAgenticAI:
    def __init__(self):
        self.pdf_kb = PDFKnowledgeBase()
        self.llm = Llama3Local()
    
    def process_message(self, message, session_id, session_data):
        context_results = self.pdf_kb.search(message)
        context_text = ""
        if context_results:
            context_text = "\n".join([r['chunk']['text'] for r in context_results])
        
        system_prompt = "Use the context to answer. If not in context, say you don't know."
        prompt = f"Context:\n{context_text}\n\nQuestion: {message}"
        
        response_text = self.llm.generate(prompt, system_prompt)
        
        return {"message": response_text, "session_id": session_id}

agent = LocalAgenticAI()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    message = data.get('message')
    session_id = data.get('session_id', str(uuid.uuid4()))
    
    if session_id not in sessions_data:
        sessions_data[session_id] = {'history': []}
    
    response = agent.process_message(message, session_id, sessions_data[session_id])
    return jsonify(response)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)