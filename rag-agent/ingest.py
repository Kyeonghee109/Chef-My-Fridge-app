from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path

from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document

from recipe_loader import load_recipes, recipe_to_document


EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def main() -> None:
    """레시피 원본을 읽어 임베딩하고 Chroma 컬렉션에 저장합니다."""
    load_dotenv()
    parser = argparse.ArgumentParser(description="레시피를 Chroma에 색인합니다.")
    parser.add_argument("--reset", action="store_true", help="기존 Chroma 데이터를 삭제하고 다시 색인합니다. (기본 동작)")
    parser.add_argument("--append", action="store_true", help="기존 컬렉션을 유지하고 문서를 추가합니다.")
    args = parser.parse_args()

    base_dir = Path(__file__).parent
    data_path = Path(os.getenv("DATA_PATH", base_dir / "data/recipes.json"))
    chroma_dir = Path(os.getenv("CHROMA_DIR", base_dir / "chroma_db"))
    # 데이터셋이 바뀌었을 때 오래된 임베딩이 섞이지 않도록 기본적으로 DB를 초기화합니다.
    if chroma_dir.exists() and (args.reset or not args.append):
        shutil.rmtree(chroma_dir)

    recipes = load_recipes(data_path)
    documents = [
        Document(page_content=recipe_to_document(recipe), metadata={"recipe_id": recipe["id"], "title": recipe["title"]})
        for recipe in recipes
    ]
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    Chroma.from_documents(
        documents=documents,
        embedding=embeddings,
        persist_directory=str(chroma_dir),
        collection_name="recipes",
    )
    print(f"Chroma 색인 완료: {len(documents)}개 레시피 ({chroma_dir})")


if __name__ == "__main__":
    main()
