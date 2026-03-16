import React, { useState, useRef } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { 
  BookOpen, 
  Mic, 
  FileText, 
  Share2, 
  Library, 
  Facebook,
  Image as ImageIcon, 
  Loader2, 
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Copy,
  History,
  Trash2,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence, useScroll, useTransform } from 'motion/react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper to create a WAV header for raw PCM data from Gemini TTS
function createWavHeader(pcmData: Uint8Array, sampleRate: number = 24000): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF identifier
  view.setUint32(0, 0x52494646, false); // "RIFF"
  // file length
  view.setUint32(4, 36 + pcmData.length, true);
  // RIFF type
  view.setUint32(8, 0x57415645, false); // "WAVE"
  // format chunk identifier
  view.setUint32(12, 0x666d7420, false); // "fmt "
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (1 is PCM)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, 1, true); // Mono
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  view.setUint32(36, 0x64617461, false); // "data"
  // data chunk length
  view.setUint32(40, pcmData.length, true);

  const wav = new Uint8Array(header.byteLength + pcmData.length);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcmData, 44);
  return wav;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

type SummaryType = 'report' | 'podcast' | 'social' | 'library';
type AudioFormat = 'deep_dive' | 'summary' | 'critique' | 'debate' | 'insight_15m';

interface BookData {
  title: string;
  author: string;
  description: string;
  episodeNumber: string;
  imageBase64?: string;
}

interface SavedSummary {
  id: number;
  title: string;
  author: string;
  summary: string;
  key_points: string;
  analysis: string;
  intro: string;
  type: string;
  created_at: string;
}

// Logo Component
const Logo = ({ className, size = 24 }: { className?: string, size?: number }) => (
  <div className={cn("relative flex items-center justify-center", className)}>
    <img 
      src="https://ais-pre-33mxmb2xhmppno5ng3s5qd-472361433527.asia-southeast1.run.app/logo.png" 
      alt="Logo Trung tâm Văn hóa và Thư viện Hà Nội"
      className="w-full h-full object-contain"
      onError={(e) => {
        // Fallback to Library icon if image fails to load
        e.currentTarget.style.display = 'none';
        e.currentTarget.parentElement?.classList.add('flex', 'items-center', 'justify-center');
        const icon = document.createElement('div');
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/><path d="M12 2H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-4"/><path d="M12 2v4"/></svg>`;
        e.currentTarget.parentElement?.appendChild(icon.firstChild as Node);
      }}
    />
  </div>
);

export default function App() {
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 1000], [0, -200]);
  const [loading, setLoading] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [titleError, setTitleError] = useState(false);
  const [summary, setSummary] = useState<string>('');
  const [keyPoints, setKeyPoints] = useState<string>('');
  const [analysis, setAnalysis] = useState<string>('');
  const [bookIntro, setBookIntro] = useState<string>('');
  const [podcastCovers, setPodcastCovers] = useState<string[]>([]);
  const [summaryType, setSummaryType] = useState<SummaryType>('report');
  const [bookImage, setBookImage] = useState<string | null>(null);
  const [history, setHistory] = useState<SavedSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [ttsText, setTtsText] = useState('');
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState('Zephyr');
  const [speechRate, setSpeechRate] = useState('normal');
  const [audioFormat, setAudioFormat] = useState<AudioFormat>('deep_dive');
  const [audioLanguage, setAudioLanguage] = useState('Tiếng Việt');
  const [audioLength, setAudioLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [podcastInfo, setPodcastInfo] = useState({
    title: '',
    description: '',
  });
  const [bookInfo, setBookInfo] = useState<BookData>({
    title: '',
    author: '',
    description: '',
    episodeNumber: '',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const response = await fetch('/api/summaries');
      if (response.ok) {
        const data = await response.json();
        setHistory(data);
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
    }
  };

  const saveToHistory = async () => {
    if (!bookInfo.title || (!summary && !keyPoints && !analysis && !bookIntro)) return;
    
    setLoading(true);
    try {
      const response = await fetch('/api/summaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: bookInfo.title,
          author: bookInfo.author,
          summary,
          key_points: keyPoints,
          analysis,
          intro: bookIntro,
          type: summaryType
        }),
      });
      
      if (response.ok) {
        setCopyFeedback('Đã lưu vào lịch sử!');
        setTimeout(() => setCopyFeedback(null), 3000);
        fetchHistory();
      }
    } catch (error) {
      console.error('Failed to save summary:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteFromHistory = async (id: number) => {
    try {
      const response = await fetch(`/api/summaries/${id}`, { method: 'DELETE' });
      if (response.ok) {
        setHistory(history.filter(h => h.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete summary:', error);
    }
  };

  const loadFromHistory = (item: SavedSummary) => {
    setBookInfo({
      title: item.title,
      author: item.author || '',
      description: '',
      episodeNumber: '',
    });
    setSummary(item.summary || '');
    setKeyPoints(item.key_points || '');
    setAnalysis(item.analysis || '');
    setBookIntro(item.intro || '');
    setSummaryType(item.type as SummaryType);
    setShowHistory(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setBookImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback('Đã sao chép nội dung!');
      setTimeout(() => setCopyFeedback(null), 3000);
    } catch (err) {
      console.error('Failed to copy: ', err);
      setCopyFeedback('Lỗi khi sao chép.');
      setTimeout(() => setCopyFeedback(null), 3000);
    }
  };

  const shareToNotebookLM = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback('Đã sao chép! Hãy dán vào NotebookLM để tạo Audio Overview.');
      setTimeout(() => setCopyFeedback(null), 5000);
      window.open('https://notebooklm.google.com/', '_blank');
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  const shareToCanva = async (base64: string) => {
    try {
      // Convert base64 to blob
      const response = await fetch(base64);
      const blob = await response.blob();
      
      // Copy to clipboard
      const item = new ClipboardItem({ [blob.type]: blob });
      await navigator.clipboard.write([item]);
      
      setCopyFeedback('Đã sao chép ảnh! Hãy dán (Ctrl+V) vào Canva.');
      setTimeout(() => setCopyFeedback(null), 3000);
      window.open('https://www.canva.com/', '_blank');
    } catch (err) {
      console.error('Failed to share to Canva: ', err);
      setCopyFeedback('Không thể sao chép ảnh. Hãy tải xuống và tải lên Canva.');
      setTimeout(() => setCopyFeedback(null), 3000);
      window.open('https://www.canva.com/', '_blank');
    }
  };

  const generateSummary = async () => {
    if (!bookInfo.title) {
      setTitleError(true);
      return '';
    }
    setTitleError(false);
    setLoading(true);
    try {
      const prompt = `
        Đóng vai trò là một nhà phê bình văn học và biên tập viên thư viện chuyên nghiệp.
        Hãy tóm tắt cuốn sách sau đây theo phong cách: ${summaryType === 'report' ? 'Báo cáo chi tiết' : summaryType === 'podcast' ? 'Kịch bản Podcast' : summaryType === 'social' ? 'Review Fanpage' : 'Tài liệu Thư viện'}.
        ${bookInfo.episodeNumber ? `Đây là số thứ tự ${bookInfo.episodeNumber} trong chuỗi Podcast.` : ''}
        
        Thông tin sách:
        Tiêu đề: ${bookInfo.title}
        Tác giả: ${bookInfo.author}
        Mô tả ngắn: ${bookInfo.description}
        ${bookInfo.episodeNumber ? `Số tập: ${bookInfo.episodeNumber}` : ''}
        
        Yêu cầu:
        1. Nội dung sâu sắc, chuyên nghiệp với ngôn ngữ trau chuốt.
        2. Phân tích các giá trị cốt lõi, thông điệp và bài học.
        3. Phù hợp với đối tượng độc giả của TRUNG TÂM VĂN HÓA VÀ THƯ VIỆN HÀ NỘI.
        4. Nếu có ảnh bìa, hãy phân tích phong cách thiết kế bìa nếu có thể.
        5. Toàn bộ nội dung trả về bằng tiếng Việt.
      `;

      const parts: any[] = [{ text: prompt }];
      if (bookImage) {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: bookImage.split(',')[1],
          },
        });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts },
      });

      const text = response.text || 'Không thể tạo tóm tắt.';
      setSummary(text);
      return text;
    } catch (error) {
      console.error(error);
      setSummary('Đã xảy ra lỗi khi tạo tóm tắt.');
      return '';
    } finally {
      setLoading(false);
    }
  };

  const generateKeyPoints = async () => {
    if (!bookInfo.title) {
      setTitleError(true);
      return '';
    }
    setTitleError(false);
    setLoading(true);
    try {
      const prompt = `
        Đóng vai trò là một nhà phê bình văn học và biên tập viên thư viện chuyên nghiệp của TRUNG TÂM VĂN HÓA VÀ THƯ VIỆN HÀ NỘI.
        Thực hiện phân tích và tóm tắt các ĐIỂM CHÍNH của cuốn sách "${bookInfo.title}" của tác giả "${bookInfo.author}".

        YÊU CẦU NỘI DUNG BAO GỒM:
        1. Phân tích thông điệp cốt lõi và các giá trị tư tưởng của tác phẩm.
        2. Xác định các đặc điểm nổi bật về nội dung và nghệ thuật (phong cách viết, cách kể chuyện, cấu trúc tác phẩm).
        3. Nêu rõ ý nghĩa thực tiễn và giá trị ứng dụng (đặc biệt nếu là sách kỹ năng, giáo dục hoặc lịch sử).
        
        PHONG CÁCH VIẾT:
        - Rõ ràng, mạch lạc, súc tích.
        - Ngôn ngữ chuyên nghiệp, phù hợp làm tài liệu thư viện hoặc kịch bản podcast.
        - Cấu trúc với các tiêu đề rõ ràng.
        - Toàn bộ nội dung trả về bằng tiếng Việt.
      `;

      const parts: any[] = [{ text: prompt }];
      if (bookImage) {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: bookImage.split(',')[1],
          },
        });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts },
      });

      const text = response.text || 'Không thể tạo tóm tắt trọng tâm.';
      setKeyPoints(text);
      return text;
    } catch (error) {
      console.error(error);
      setKeyPoints('Đã xảy ra lỗi khi tạo tóm tắt trọng tâm.');
      return '';
    } finally {
      setLoading(false);
    }
  };

  const shareToFacebook = () => {
    const url = window.location.href;
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
  };

  const generateAnalysis = async () => {
    if (!bookInfo.title) {
      setTitleError(true);
      return '';
    }
    setTitleError(false);
    setLoading(true);
    try {
      const prompt = `
        Đóng vai trò là chuyên gia biên mục và giới thiệu sách chuyên nghiệp của TRUNG TÂM VĂN HÓA VÀ THƯ VIỆN HÀ NỘI.
        Thực hiện PHÂN TÍCH CHỦ ĐỀ VÀ TỪ KHÓA cho cuốn sách "${bookInfo.title}" của tác giả "${bookInfo.author}".

        YÊU CẦU NỘI DUNG BAO GỒM:
        1. CHỦ ĐỀ BAO QUÁT (Broad Topics): Xác định 3-5 chủ đề chính mà cuốn sách đề cập đến (ví dụ: Lịch sử, Tâm lý học, Kỹ năng sống, Văn hóa Hà Nội...).
        2. TỪ KHÓA QUAN TRỌNG (Important Keywords): Trích xuất 10-15 từ khóa cốt lõi phục vụ công tác tìm kiếm và biên mục thư viện.
        3. NHÂN VẬT & KHÁI NIỆM CỐT LÕI (Core Characters/Concepts): Liệt kê các nhân vật chính (nếu là văn học) hoặc các học thuyết/khái niệm trung tâm (nếu là sách chuyên ngành/kỹ năng).
        4. GIÁ TRỊ BIÊN MỤC: Đưa ra gợi ý phân loại sách phù hợp cho hệ thống thư viện.

        PHONG CÁCH TRÌNH BÀY:
        - Trình bày dưới dạng danh sách rõ ràng, dễ tra cứu.
        - Ngôn ngữ chuẩn mực, chuyên nghiệp.
        - Sử dụng Markdown để định dạng các tiêu đề và danh sách.
      `;

      const parts: any[] = [{ text: prompt }];
      if (bookImage) {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: bookImage.split(',')[1],
          },
        });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts },
      });

      const text = response.text || 'Không thể thực hiện phân tích chủ đề.';
      setAnalysis(text);
      return text;
    } catch (error) {
      console.error(error);
      setAnalysis('Đã xảy ra lỗi khi thực hiện phân tích chủ đề.');
      return '';
    } finally {
      setLoading(false);
    }
  };

  const generateBookIntro = async () => {
    if (!bookInfo.title) {
      setTitleError(true);
      return '';
    }
    setTitleError(false);
    setLoading(true);
    try {
      const prompt = `
        Đóng vai trò là một chuyên gia truyền thông và biên tập viên cao cấp của TRUNG TÂM VĂN HÓA VÀ THƯ VIỆN HÀ NỘI.
        Hãy viết một bài GIỚI THIỆU SÁCH chuyên nghiệp, hấp dẫn cho cuốn sách "${bookInfo.title}" của tác giả "${bookInfo.author}".

        YÊU CẦU NỘI DUNG:
        1. LỜI MỞ ĐẦU (Hook): Một đoạn văn ngắn gây ấn tượng, khơi gợi trí tò mò của độc giả.
        2. GIỚI THIỆU TÁC GIẢ & TÁC PHẨM: Nêu bật vị thế của tác giả và bối cảnh ra đời của cuốn sách.
        3. TÓM TẮT NỘI DUNG SÁNG TẠO: Không chỉ là tóm tắt cốt truyện mà là giới thiệu những nét đặc sắc nhất.
        4. TẠI SAO NÊN ĐỌC: Đưa ra 3 lý do thuyết phục tại sao độc giả của Thư viện Hà Nội không nên bỏ qua cuốn sách này.
        5. LỜI KẾT: Một thông điệp ý nghĩa hoặc lời mời gọi độc giả đến thư viện mượn sách.

        PHONG CÁCH VIẾT:
        - Văn phong trang trọng nhưng vẫn gần gũi, truyền cảm hứng.
        - Sử dụng ngôn ngữ giàu hình ảnh, trau chuốt.
        - Phù hợp để đăng trên Website thư viện, Bản tin văn hóa hoặc Fanpage.
        - Sử dụng Markdown để định dạng (tiêu đề, in đậm, trích dẫn).
        - Toàn bộ nội dung trả về bằng tiếng Việt.
      `;

      const parts: any[] = [{ text: prompt }];
      if (bookImage) {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: bookImage.split(',')[1],
          },
        });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts },
      });

      const text = response.text || 'Không thể tạo bài giới thiệu sách.';
      setBookIntro(text);
      return text;
    } catch (error) {
      console.error(error);
      setBookIntro('Đã xảy ra lỗi khi tạo bài giới thiệu sách.');
      return '';
    } finally {
      setLoading(false);
    }
  };

  const generatePodcastCover = async () => {
    const finalTitle = podcastInfo.title || bookInfo.title;
    const finalDescription = podcastInfo.description || bookInfo.description;
    
    if (!finalTitle && !bookImage) {
      setTitleError(true);
      return;
    }
    setTitleError(false);
    setLoading(true);
    setPodcastCovers([]);
    try {
      const basePrompt = `
        Create a VIBRANT, MODERN, and ARTISTIC Podcast cover deeply inspired by Vietnamese culture for a podcast titled "${finalTitle}".
        ${bookInfo.episodeNumber ? `Episode Number: ${bookInfo.episodeNumber}.` : ''}
        ${finalDescription ? `Podcast content description: ${finalDescription}` : ''}
        
        DESIGN STYLE: 
        - Modern, high-contrast, artistic, and sophisticated.
        - Deeply rooted in Vietnamese culture: use bold traditional patterns (like Dong Son drum patterns), iconic Hanoi architecture (Hanoi Old Quarter, Hoan Kiem Lake), or literary symbols, blended with modern graphic design elements.
        - Luxurious, contemporary, and visually striking.
        
        MANDATORY ELEMENTS ON IMAGE:
        1. TOP TEXT: "Hanoi Culture and Library Center" placed clearly at the very top.
        2. LARGE TEXT: The word "PODCAST" must be the MOST PROMINENT element, using large, bold, artistic, and highly legible typography that stands out immediately.
        3. CENTRAL VISUAL: A professional podcast microphone as the central focus, seamlessly integrated with the Vietnamese cultural elements.
        4. BOTTOM TEXT: "Copyright © 2026 by Hanoi Cultural and Library Center. All rights reserved" placed at the bottom.
        5. Main visual: Harmoniously integrate the podcast theme "${finalTitle}" with the central microphone, bold Vietnamese cultural motifs, and modern artistic flair.
      `;

      // Generate 4 different variations by adding slight variations to the prompt
      const variations = [
        "Style: Traditional Vietnamese lacquerware, vermilion and gold leaf colors.",
        "Style: Cinematic photography, ethereal lighting, nostalgic atmosphere.",
        "Style: Watercolor illustration, elegant, delicate like silk painting.",
        "Style: Modern graphic design, minimalist, focusing on literary symbols."
      ];

      const generateSingleCover = async (variation: string) => {
        const parts: any[] = [{ text: `${basePrompt}\n${variation}` }];
        if (bookImage) {
          const base64Data = bookImage.split(',')[1];
          if (base64Data.length < 1000000) { // 1MB limit
            parts.push({
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Data,
              },
            });
          } else {
            console.warn("Book image is too large, skipping it.");
          }
        }

        try {
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts },
            config: {
              imageConfig: {
                aspectRatio: "16:9",
              }
            }
          });

          if (!response.candidates || response.candidates.length === 0) {
            console.error("No candidates in response");
            return null;
          }

          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
              return `data:image/png;base64,${part.inlineData.data}`;
            }
          }
        } catch (error) {
          console.error("Error generating single cover:", error);
        }
        return null;
      };

      const results = await Promise.all(variations.map(v => generateSingleCover(v)));
      setPodcastCovers(results.filter((img): img is string => img !== null));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const generateAll = async () => {
    if (!bookInfo.title) {
      setTitleError(true);
      return;
    }
    setTitleError(false);
    setLoading(true);
    try {
      const s = await generateSummary();
      const k = await generateKeyPoints();
      const a = await generateAnalysis();
      const i = await generateBookIntro();
      
      // Save automatically after comprehensive analysis
      const response = await fetch('/api/summaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: bookInfo.title,
          author: bookInfo.author,
          summary: s,
          key_points: k,
          analysis: a,
          intro: i,
          type: summaryType
        }),
      });
      if (response.ok) fetchHistory();
      
      setCopyFeedback('Đã hoàn thành và lưu phân tích!');
      setTimeout(() => setCopyFeedback(null), 3000);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const generateGoogleTts = async (text: string, voiceName: string, languageCode: string) => {
    setTtsLoading(true);
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceName, languageCode }),
      });
      if (!response.ok) throw new Error("Failed to generate audio");
      const audioBlob = await response.blob();
      if (ttsAudioUrl) URL.revokeObjectURL(ttsAudioUrl);
      setTtsAudioUrl(URL.createObjectURL(audioBlob));
    } catch (error) {
      console.error("Google TTS error:", error);
    } finally {
      setTtsLoading(false);
    }
  };

  const generateTts = async () => {
    if (!ttsText) return;
    if (ttsText.length > 2000) {
        alert("Văn bản quá dài (tối đa 2000 ký tự). Vui lòng nhập ngắn hơn.");
        return;
    }
    setTtsLoading(true);
    try {
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: ttsText }] }],
        config: {
          systemInstruction: "Bạn là phát thanh viên thời sự chuyên nghiệp. Đọc rõ ràng, tròn vành rõ chữ, tốc độ vừa phải, nhấn mạnh 5W1H, ngắt nghỉ đúng dấu câu. Chỉ tạo âm thanh, không tạo thêm văn bản.",
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice }
            }
          }
        }
      });

      const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const wavBytes = createWavHeader(bytes, 24000);
        const audioBlob = new Blob([wavBytes], { type: 'audio/wav' });
        if (ttsAudioUrl) URL.revokeObjectURL(ttsAudioUrl);
        setTtsAudioUrl(URL.createObjectURL(audioBlob));
      }
    } catch (error) {
      console.error("TTS error:", error);
    } finally {
      setTtsLoading(false);
    }
  };

  const generateAudioOverview = async () => {
    if (!bookInfo.title) {
      setTitleError(true);
      return;
    }
    setTitleError(false);
    setAudioLoading(true);
    setAudioUrl(null);

    try {
      // 1. Generate the script
      const scriptPrompt = `
        Đóng vai trò là biên tập viên cao cấp của TRUNG TÂM VĂN HÓA VÀ THƯ VIỆN HÀ NỘI.
        Hãy viết một kịch bản âm thanh cho cuốn sách "${bookInfo.title}" của tác giả "${bookInfo.author}".
        
        ĐỊNH DẠNG: ${
          audioFormat === 'deep_dive' ? 'Cuộc trò chuyện sâu sắc giữa 2 người dẫn chương trình (Nam và Nữ)' :
          audioFormat === 'summary' ? 'Bản tóm tắt ngắn gọn do 1 người dẫn chương trình thực hiện' :
          audioFormat === 'critique' ? 'Bài phê bình chuyên gia do 1 nhà phê bình thực hiện' :
          audioFormat === 'debate' ? 'Cuộc tranh luận sôi nổi giữa 2 người dẫn chương trình về các quan điểm khác nhau' :
          'Bản tóm tắt "15 phút tinh hoa" tập trung vào 5 insight giá trị nhất, không tóm tắt toàn bộ nội dung mà chỉ xoáy sâu vào các ý tưởng đột phá'
        }.
        
        YÊU CẦU:
        - Ngôn ngữ: ${audioLanguage}.
        - Độ dài: ${audioFormat === 'insight_15m' ? 'Khoảng 15 phút (vui lòng viết kịch bản đủ dài)' : audioLength === 'short' ? 'Ngắn (khoảng 2 phút)' : audioLength === 'medium' ? 'Trung bình (khoảng 5 phút)' : 'Dài (khoảng 10 phút)'}.
        - Phong cách: Chuyên nghiệp, ấm áp, giọng Bắc chuẩn, rõ ràng, phù hợp với người trẻ (khoảng 23 tuổi), tạo cảm giác gần gũi nhưng vẫn chuyên nghiệp.
        - Tốc độ nói: ${speechRate === 'slow' ? 'Chậm rãi, rõ ràng' : speechRate === 'fast' ? 'Nhanh, năng động' : 'Tốc độ bình thường'}.
        - Nếu là định dạng 2 người (Deep Dive/Debate), hãy sử dụng định dạng:
          Tuấn: [Nội dung]
          Minh Anh: [Nội dung]
        - TUYỆT ĐỐI KHÔNG giới thiệu tên MC, người dẫn chương trình hoặc biên tập viên trong nội dung nói (ví dụ: không nói "Tôi là Tuấn", "Chào mừng các bạn đến với chương trình của Minh Anh", v.v.). Hãy đi thẳng vào nội dung hoặc giới thiệu chung về Trung tâm Văn hóa và Thư viện Hà Nội.
        ${audioFormat === 'insight_15m' ? '- Cấu trúc kịch bản cho 5 insight: Mỗi insight cần có phần đặt vấn đề, nội dung cốt lõi và bài học ứng dụng.' : ''}
        - Toàn bộ nội dung trả về bằng tiếng Việt.
      `;

      const scriptResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: scriptPrompt,
      });

      const script = scriptResponse.text;
      if (!script) throw new Error("Failed to generate script");

      // 2. Generate the audio using TTS
      const isMultiSpeaker = audioFormat === 'deep_dive' || audioFormat === 'debate';
      
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: script }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: isMultiSpeaker ? {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                {
                  speaker: 'Tuấn',
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } }
                },
                {
                  speaker: 'Minh Anh',
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice === 'Puck' ? 'Zephyr' : 'Puck' } }
                }
              ]
            }
          } : {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice }
            }
          }
        }
      });

      const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        // Convert base64 to Uint8Array
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Add WAV header (Gemini TTS returns raw PCM at 24kHz)
        const wavBytes = createWavHeader(bytes, 24000);
        const audioBlob = new Blob([wavBytes], { type: 'audio/wav' });
        
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(audioBlob));
        setCopyFeedback('Đã tạo xong bản âm thanh!');
        setTimeout(() => setCopyFeedback(null), 3000);
      }
    } catch (error) {
      console.error("Audio generation error:", error);
      setCopyFeedback('Lỗi khi tạo âm thanh.');
      setTimeout(() => setCopyFeedback(null), 3000);
    } finally {
      setAudioLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-primary/20 selection:text-white relative overflow-x-hidden">
      {/* Background Image Overlay - Spotlighted Gallery Vibe */}
      <motion.div style={{ y }} className="absolute inset-0 z-0 pointer-events-none">
        <img 
          src="https://images.unsplash.com/photo-1507842217343-583bb7270b66?q=80&w=2000&auto=format&fit=crop" 
          alt="Atmospheric Library Background" 
          className="w-full h-full object-cover brightness-[0.12] contrast-[1.1] sepia-[0.3]"
          referrerPolicy="no-referrer"
        />
        {/* Triple Spotlight Effect */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,245,200,0.05)_0%,transparent_40%),radial-gradient(circle_at_50%_0%,rgba(255,245,200,0.08)_0%,transparent_45%),radial-gradient(circle_at_80%_0%,rgba(255,245,200,0.05)_0%,transparent_40%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/95" />
        <div className="absolute inset-0 paper-texture opacity-[0.03] mix-blend-overlay" />
      </motion.div>

      {/* Feedback Toast */}
      <AnimatePresence>
        {copyFeedback && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-ink text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-white/10"
          >
            <CheckCircle2 size={18} className="text-emerald-400" />
            <span className="text-sm font-bold uppercase tracking-widest">{copyFeedback}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="border-b border-white/5 bg-black/40 backdrop-blur-xl sticky top-0 z-50 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 sm:h-28 flex items-center justify-between">
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-white/5 rounded-full flex items-center justify-center text-white/80 shadow-2xl shadow-black/40 shrink-0 border border-white/10 overflow-hidden p-1.5 group hover:border-primary/30 transition-all duration-500">
              <Logo size={24} className="sm:w-10 sm:h-10 group-hover:scale-110 transition-transform duration-500" />
            </div>
            <div className="space-y-0.5">
              <h1 className="font-serif text-[20px] sm:text-[28px] text-white leading-none tracking-tight uppercase">
                TRUNG TÂM VĂN HÓA VÀ THƯ VIỆN
              </h1>
              <div className="flex items-center gap-3">
                <div className="h-px w-8 bg-terracotta/40" />
                <p className="font-serif text-[16px] sm:text-[22px] text-terracotta tracking-[0.3em] uppercase italic font-medium">
                  HÀ NỘI
                </p>
              </div>
            </div>
          </div>
          <div className="hidden lg:flex items-center gap-8">
            <button 
              onClick={shareToFacebook}
              className="flex items-center gap-3 px-6 py-2.5 bg-white/5 border border-white/10 rounded-full text-white/60 hover:text-[#1877F2] hover:bg-white/10 hover:border-[#1877F2]/20 transition-all duration-300 group"
              title="Chia sẻ lên Facebook"
            >
              <Facebook size={18} strokeWidth={1.5} className="group-hover:scale-110 transition-transform duration-500" />
              <span className="text-[11px] font-bold uppercase tracking-[0.2em]">Chia sẻ</span>
            </button>
            <div className="h-12 w-px bg-white/10" />
            <button 
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-3 px-6 py-2.5 bg-white/5 border border-white/10 rounded-full text-white/60 hover:text-white hover:bg-white/10 hover:border-primary/20 transition-all duration-300 group"
            >
              <History size={18} strokeWidth={1.5} className="group-hover:rotate-[-45deg] transition-transform duration-500" />
              <span className="text-[11px] font-bold uppercase tracking-[0.2em]">PODCAST TOOL</span>
            </button>
            <div className="h-12 w-px bg-white/10" />
            <div className="text-right space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary/80">Hệ thống Tri thức số</p>
              <p className="text-sm font-serif italic text-white/40">Lưu giữ tinh hoa văn hóa</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 lg:py-12 relative z-10">
        {/* Hero Section inspired by the image */}
        <div className="min-h-[60vh] flex flex-col justify-center mb-20 sm:mb-32 relative">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-12 sm:space-y-16"
          >
            <div className="flex items-center gap-6">
              <div className="h-px w-12 sm:w-20 bg-primary/40" />
              <h2 className="font-commons font-bold text-[14px] sm:text-[18px] text-primary leading-none tracking-[0.4em] drop-shadow-2xl uppercase">
                DI SẢN & TRI THỨC
              </h2>
            </div>
            
            <div className="max-w-4xl space-y-10">
              <h1 className="font-serif text-[40px] sm:text-[72px] lg:text-[90px] text-white leading-[1.1] tracking-tight">
                Gìn giữ <span className="italic text-terracotta">Hồn Việt</span>,<br />
                Lan tỏa <span className="italic text-primary">Tri thức số</span>.
              </h1>
              <p className="text-lg sm:text-xl text-white/60 leading-relaxed max-w-2xl font-serif italic tracking-wide">
                "Nơi kết nối truyền thống ngàn năm với công nghệ tương lai, biến mỗi trang sách thành một hành trình trải nghiệm đa giác quan."
              </p>
            </div>

            <div className="flex items-center gap-12 pt-8">
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/30">Thành lập</span>
                <span className="font-serif text-2xl text-white/80 italic">Từ 1954</span>
              </div>
              <div className="h-12 w-px bg-white/10" />
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/30">Sứ mệnh</span>
                <span className="font-serif text-2xl text-white/80 italic">Lan tỏa Văn hóa Đọc</span>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-12 lg:gap-16 items-start">
          {/* Left Sidebar: Input */}
        <div className="lg:sticky lg:top-32 space-y-8 lg:space-y-12">
          <section className="library-card p-8 sm:p-10 space-y-10 relative overflow-hidden group/card">
            <div className="absolute -top-10 -right-10 opacity-[0.03] pointer-events-none group-hover/card:opacity-[0.05] transition-opacity duration-700">
              <BookOpen size={240} className="text-white" />
            </div>
            
            <div className="relative">
              <div className="flex items-center gap-4 mb-10">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                  <Library size={20} strokeWidth={1.5} />
                </div>
                <h2 className="font-commons font-bold text-[16px] text-white uppercase tracking-[0.2em]">
                  Danh mục tác phẩm
                </h2>
              </div>
              
              <div className="space-y-10">
                <div className="flex gap-8 items-start">
                  <div className="flex-1 group/input">
                    <label className={cn(
                      "block text-[10px] font-bold uppercase tracking-[0.3em] mb-3 transition-colors opacity-40",
                      titleError ? "text-red-400 opacity-100" : "group-focus-within/input:text-primary group-focus-within/input:opacity-100"
                    )}>
                      Tiêu đề sách {titleError && <span className="text-red-400 ml-2 italic font-normal text-[9px] tracking-normal">(Yêu cầu)</span>}
                    </label>
                    <input 
                      type="text" 
                      value={bookInfo.title}
                      onChange={(e) => {
                        setBookInfo({...bookInfo, title: e.target.value});
                        if (e.target.value) setTitleError(false);
                      }}
                      placeholder="Nhập tên sách..."
                      className={cn(
                        "w-full px-0 py-3 bg-transparent border-b transition-all duration-500 outline-none font-serif text-2xl placeholder:text-white/5",
                        titleError ? "border-red-400" : "border-white/10 focus:border-primary/40"
                      )}
                    />
                  </div>

                  <div className="w-24 shrink-0">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.3em] opacity-40 mb-3 text-center">Bìa sách</label>
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "relative aspect-[3/4.2] rounded-xl border border-dashed flex flex-col items-center justify-center cursor-pointer transition-all duration-700 overflow-hidden group/img shadow-2xl",
                        bookImage ? "border-transparent" : "border-white/10 hover:border-primary/30 hover:bg-primary/[0.02]"
                      )}
                    >
                      {bookImage ? (
                        <>
                          <img src={bookImage} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity duration-500">
                            <Upload size={20} className="text-white" />
                          </div>
                        </>
                      ) : (
                        <div className="text-center space-y-2">
                          <ImageIcon className="text-white/10 group-hover/img:text-primary/40 transition-colors w-8 h-8 mx-auto" strokeWidth={1} />
                          <span className="text-[8px] font-bold uppercase tracking-widest text-white/20">Tải lên</span>
                        </div>
                      )}
                      <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                    </div>
                  </div>
                </div>

                <div className="group/input">
                  <label className="block text-[10px] font-bold uppercase tracking-[0.3em] opacity-40 mb-3 group-focus-within/input:text-primary group-focus-within/input:opacity-100 transition-colors">Tác giả / Dịch giả</label>
                  <input 
                    type="text" 
                    value={bookInfo.author}
                    onChange={(e) => setBookInfo({...bookInfo, author: e.target.value})}
                    placeholder="Tên tác giả..."
                    className="w-full px-0 py-3 bg-transparent border-b border-white/10 focus:border-primary/40 transition-all duration-500 outline-none font-serif text-2xl placeholder:text-white/5"
                  />
                </div>
                <div className="grid grid-cols-2 gap-10">
                  <div className="group/input">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.3em] opacity-40 mb-3 group-focus-within/input:text-primary group-focus-within/input:opacity-100 transition-colors">Số tập / Kỳ</label>
                    <input 
                      type="text" 
                      value={bookInfo.episodeNumber}
                      onChange={(e) => setBookInfo({...bookInfo, episodeNumber: e.target.value})}
                      placeholder="01"
                      className="w-full px-0 py-3 bg-transparent border-b border-white/10 focus:border-primary/40 transition-all duration-500 outline-none font-serif text-2xl placeholder:text-white/5"
                    />
                  </div>
                  <div className="flex items-end pb-4">
                    <span className="text-[9px] text-white/20 italic tracking-[0.2em] uppercase font-medium">Phân loại Podcast</span>
                  </div>
                </div>

                <div className="pt-4">
                  <button
                    onClick={generatePodcastCover}
                    disabled={loading || (!bookInfo.title && !bookImage)}
                    className="w-full py-4 bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-xl text-[11px] font-bold uppercase tracking-[0.2em] text-primary flex items-center justify-center gap-3 transition-all disabled:opacity-50 shadow-lg shadow-primary/5"
                  >
                    {loading ? <Loader2 className="animate-spin" size={16} /> : <ImageIcon size={16} strokeWidth={1.5} />}
                    Thiết kế bìa Podcast (4 mẫu)
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="library-card p-8 sm:p-10 space-y-10 relative overflow-hidden group/card">
            <div className="absolute -top-10 -right-10 opacity-[0.03] pointer-events-none group-hover/card:opacity-[0.05] transition-opacity duration-700">
              <Mic size={240} className="text-white" />
            </div>
            
            <div className="relative">
              <div className="flex items-center gap-4 mb-10">
                <div className="w-12 h-12 rounded-full bg-terracotta/10 flex items-center justify-center text-terracotta border border-terracotta/20">
                  <Mic size={20} strokeWidth={1.5} />
                </div>
                <h2 className="font-commons font-bold text-[16px] text-white uppercase tracking-[0.2em]">
                  Âm thanh Thư viện
                </h2>
              </div>
              
              <div className="space-y-8">
                <div className="space-y-4">
                  <label className="block text-[10px] font-bold uppercase tracking-[0.3em] opacity-40">Định dạng Podcast</label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { id: 'deep_dive', label: 'Đối thoại', desc: 'Sâu sắc' },
                      { id: 'summary', label: 'Tóm lược', desc: 'Ngắn gọn' },
                      { id: 'critique', label: 'Phê bình', desc: 'Chuyên gia' },
                      { id: 'debate', label: 'Tranh luận', desc: 'Đa chiều' },
                      { id: 'insight_15m', label: '15 Phút', desc: '5 Insight' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setAudioFormat(f.id as AudioFormat)}
                        className={cn(
                          "p-4 rounded-xl border text-left transition-all duration-300",
                          audioFormat === f.id ? "bg-primary/10 border-primary/30 text-primary" : "bg-white/5 border-white/5 hover:border-white/20 text-white/60"
                        )}
                      >
                        <p className="text-[11px] font-bold uppercase tracking-widest mb-1">{f.label}</p>
                        <p className="text-[9px] opacity-50 italic">{f.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block text-[10px] font-bold uppercase tracking-[0.3em] opacity-40 mb-3">Tốc độ</label>
                  <select 
                    value={speechRate}
                    onChange={(e) => setSpeechRate(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] font-bold uppercase tracking-widest outline-none focus:border-primary/30 transition-all"
                  >
                    <option value="slow">Chậm</option>
                    <option value="normal">Bình thường</option>
                    <option value="fast">Nhanh</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-[0.3em] opacity-40 mb-3">Ngôn ngữ</label>
                    <select 
                      value={audioLanguage}
                      onChange={(e) => setAudioLanguage(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] font-bold uppercase tracking-widest outline-none focus:border-primary/30 transition-all"
                    >
                      <option value="Tiếng Việt">Tiếng Việt</option>
                      <option value="English">English</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-[0.3em] opacity-40 mb-3">Độ dài</label>
                    <select 
                      value={audioLength}
                      onChange={(e) => setAudioLength(e.target.value as any)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] font-bold uppercase tracking-widest outline-none focus:border-primary/30 transition-all"
                    >
                      <option value="short">Ngắn</option>
                      <option value="medium">Vừa</option>
                      <option value="long">Dài</option>
                    </select>
                  </div>
                </div>

                <button
                  onClick={generateAudioOverview}
                  disabled={audioLoading || !bookInfo.title}
                  className="w-full py-4 bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-xl text-[11px] font-bold uppercase tracking-[0.2em] text-primary flex items-center justify-center gap-3 transition-all disabled:opacity-50 shadow-lg shadow-primary/5"
                >
                  {audioLoading ? <Loader2 className="animate-spin" size={16} /> : <Mic size={16} />}
                  Khởi tạo âm thanh
                </button>

                {audioUrl && (
                  <div className="pt-4 space-y-4">
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/10 shadow-inner">
                      <audio src={audioUrl} controls className="w-full h-10 opacity-90" />
                    </div>
                    <a 
                      href={audioUrl} 
                      download={`HanoiLibrary-Podcast-${bookInfo.title || 'Audio'}.wav`}
                      className="flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-primary transition-colors"
                    >
                      <Download size={14} />
                      Tải xuống bản ghi
                    </a>
                  </div>
                )}

                <div className="pt-10 border-t border-white/5 mt-10">
                  <h3 className="font-commons font-bold text-[14px] text-white uppercase tracking-[0.2em] mb-6">Chuyển đổi Văn bản</h3>
                  
                  <div className="mb-4">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.3em] opacity-40 mb-2">Giọng đọc</label>
                    <select 
                      value={selectedVoice}
                      onChange={(e) => setSelectedVoice(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] font-bold uppercase tracking-widest outline-none focus:border-primary/30 transition-all"
                    >
                      <option value="Zephyr">Zephyr</option>
                      <option value="Puck">Puck</option>
                      <option value="Charon">Charon</option>
                      <option value="Kore">Kore</option>
                      <option value="Fenrir">Fenrir</option>
                    </select>
                  </div>

                  <textarea
                    value={ttsText}
                    onChange={(e) => setTtsText(e.target.value)}
                    placeholder="Nhập văn bản cần chuyển đổi..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] outline-none focus:border-primary/30 transition-all mb-4 h-32"
                  />
                  <button
                    onClick={generateTts}
                    disabled={ttsLoading || !ttsText}
                    className="w-full py-4 bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-xl text-[11px] font-bold uppercase tracking-[0.2em] text-primary flex items-center justify-center gap-3 transition-all disabled:opacity-50 shadow-lg shadow-primary/5"
                  >
                    {ttsLoading ? <Loader2 className="animate-spin" size={16} /> : <Mic size={16} />}
                    Tạo lời nói
                  </button>
                  {ttsAudioUrl && (
                    <div className="pt-4">
                      <audio src={ttsAudioUrl} controls className="w-full h-10 opacity-90" />
                    </div>
                  )}
                </div>

                <div className="pt-8 border-t border-white/5">
                  <div className="flex flex-col items-center gap-6 p-6 bg-primary/5 rounded-3xl border border-primary/10">
                    <div className="flex items-center gap-4 text-left w-full">
                      <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary shrink-0 border border-primary/20">
                        <Share2 size={20} strokeWidth={1.5} />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-bold text-white uppercase tracking-widest">NotebookLM?</h4>
                        <p className="text-[9px] text-white/40 font-medium uppercase tracking-widest mt-1">Tạo Audio Overview đa giọng nói từ Google</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => window.open('https://notebooklm.google.com/', '_blank')}
                      className="w-full px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                    >
                      <ExternalLink size={14} />
                      Mở NotebookLM
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4">
            <button
              onClick={generateBookIntro}
              disabled={loading || (!bookInfo.title && !bookImage)}
              className="group relative w-full py-6 bg-primary/10 text-primary border border-primary/20 rounded-2xl font-bold uppercase tracking-[0.2em] text-[11px] flex items-center justify-center gap-3 hover:bg-primary/20 hover:border-primary/40 transition-all duration-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xl overflow-hidden"
            >
              <div className="absolute inset-0 bg-primary/5 translate-y-full group-hover:translate-y-0 transition-transform duration-700" />
              <span className="relative flex items-center gap-3">
                {loading ? <Loader2 className="animate-spin" size={18} /> : <BookOpen size={18} strokeWidth={1.5} />}
                Giới thiệu tác phẩm
              </span>
            </button>
            <button
              onClick={generateSummary}
              disabled={loading || (!bookInfo.title && !bookImage)}
              className="group relative w-full py-6 bg-white/5 text-white border border-white/10 rounded-2xl font-bold uppercase tracking-[0.2em] text-[11px] flex items-center justify-center gap-3 hover:bg-white/10 hover:border-primary/30 transition-all duration-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xl overflow-hidden"
            >
              <div className="absolute inset-0 bg-primary/5 translate-y-full group-hover:translate-y-0 transition-transform duration-700" />
              <span className="relative flex items-center gap-3">
                {loading ? <Loader2 className="animate-spin" size={18} /> : <FileText size={18} strokeWidth={1.5} />}
                Tạo tóm tắt tác phẩm
              </span>
            </button>
            <button
              onClick={generateKeyPoints}
              disabled={loading || (!bookInfo.title && !bookImage)}
              className="group relative w-full py-6 bg-white/5 text-white border border-white/10 rounded-2xl font-bold uppercase tracking-[0.2em] text-[11px] flex items-center justify-center gap-3 hover:bg-white/10 hover:border-primary/30 transition-all duration-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xl overflow-hidden"
            >
              <div className="absolute inset-0 bg-primary/5 translate-y-full group-hover:translate-y-0 transition-transform duration-700" />
              <span className="relative flex items-center gap-3">
                {loading ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} strokeWidth={1.5} />}
                Điểm nhấn cốt lõi
              </span>
            </button>
            <button
              onClick={generateAnalysis}
              disabled={loading || (!bookInfo.title && !bookImage)}
              className="group relative w-full py-6 bg-white/5 text-white border border-white/10 rounded-2xl font-bold uppercase tracking-[0.2em] text-[11px] flex items-center justify-center gap-3 hover:bg-white/10 hover:border-primary/30 transition-all duration-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xl overflow-hidden"
            >
              <div className="absolute inset-0 bg-primary/5 translate-y-full group-hover:translate-y-0 transition-transform duration-700" />
              <span className="relative flex items-center gap-3">
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Share2 size={18} strokeWidth={1.5} />}
                Phân loại & Từ khóa
              </span>
            </button>

            {(summary || keyPoints || analysis || bookIntro) && (
              <button
                onClick={saveToHistory}
                disabled={loading}
                className="w-full py-6 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-2xl font-bold uppercase tracking-[0.2em] text-[11px] flex items-center justify-center gap-3 hover:bg-emerald-500/20 transition-all duration-500 disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} strokeWidth={1.5} />}
                Lưu vào kho lưu trữ
              </button>
            )}
          </div>
        </div>

        {/* Right Content: Results or History */}
        <div className="space-y-8 lg:space-y-12">
          <AnimatePresence mode="wait">
            {showHistory ? (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between mb-8">
                  <h3 className="font-commons font-bold text-[18px] text-white uppercase tracking-widest">PODCAST TOOL</h3>
                  <button 
                    onClick={() => setShowHistory(false)}
                    className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors"
                  >
                    Quay lại kết quả
                  </button>
                </div>
                
                {history.length === 0 ? (
                  <div className="p-20 text-center border border-white/5 rounded-[3rem] bg-black/20 backdrop-blur-xl">
                    <p className="text-white/40 font-serif italic text-xl">Chưa có dữ liệu PODCAST TOOL nào.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-6">
                    {history.map((item) => (
                      <div 
                        key={item.id}
                        className="bg-black/40 backdrop-blur-xl p-8 rounded-[2rem] border border-white/5 shadow-xl flex items-center justify-between group hover:border-white/20 transition-all"
                      >
                        <div className="space-y-2">
                          <h4 className="font-commons font-bold text-white text-xl">{item.title}</h4>
                          <p className="text-white/60 font-serif italic">{item.author}</p>
                          <div className="flex items-center gap-4 mt-4">
                            <span className="text-[9px] font-bold uppercase tracking-widest px-3 py-1 bg-white/5 rounded-full text-white/40">
                              {item.type}
                            </span>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-white/20">
                              {new Date(item.created_at).toLocaleDateString('vi-VN')}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => loadFromHistory(item)}
                            className="p-4 bg-white/5 rounded-2xl text-white/60 hover:text-white hover:bg-white/10 transition-all"
                            title="Xem chi tiết"
                          >
                            <ArrowRight size={20} strokeWidth={1} />
                          </button>
                          <button 
                            onClick={() => deleteFromHistory(item.id)}
                            className="p-4 bg-red-500/10 rounded-2xl text-red-400/60 hover:text-red-400 hover:bg-red-500/20 transition-all"
                            title="Xóa"
                          >
                            <Trash2 size={20} strokeWidth={1} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : summary || keyPoints || analysis || bookIntro || podcastCovers.length > 0 ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                className="space-y-12"
              >
                {/* Book Intro Section */}
                {bookIntro && (
                  <section className="library-card overflow-hidden group/result">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] min-h-[450px]">
                      <div className="p-12 bg-primary/10 flex flex-col justify-between border-r border-white/5 relative">
                        <div className="absolute inset-0 paper-texture opacity-[0.02] pointer-events-none" />
                        <div className="relative space-y-6">
                          <div className="w-16 h-1 bg-primary/40" />
                          <h2 className="text-4xl">Giới thiệu <br /><span className="italic text-primary">Tác phẩm</span></h2>
                          <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.4em]">Truyền thông Thư viện</p>
                        </div>
                        <div className="relative space-y-4">
                          <button 
                            onClick={() => copyToClipboard(bookIntro)}
                            className="w-full px-6 py-4 bg-white/10 border border-white/20 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-all flex items-center justify-center gap-3"
                          >
                            <Copy size={16} />
                            Sao chép nội dung
                          </button>
                          <button 
                            onClick={shareToFacebook}
                            className="w-full px-6 py-4 bg-[#1877F2] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-[#1877F2]/80 transition-all flex items-center justify-center gap-3 shadow-xl shadow-[#1877F2]/10"
                          >
                            <Facebook size={16} />
                            Chia sẻ Facebook
                          </button>
                          <button 
                            onClick={() => shareToNotebookLM(bookIntro)}
                            className="w-full px-6 py-4 bg-primary text-black rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-primary/80 transition-all flex items-center justify-center gap-3 shadow-xl shadow-primary/10"
                          >
                            <ExternalLink size={16} />
                            NotebookLM Overview
                          </button>
                          <button 
                            onClick={() => {
                              const blob = new Blob([bookIntro], { type: 'text/plain' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `HanoiLibrary-Intro-${bookInfo.title || 'Book'}.txt`;
                              a.click();
                            }}
                            className="w-full px-6 py-4 bg-white/5 border border-white/10 text-white/40 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:text-white hover:bg-white/10 transition-all flex items-center justify-center gap-3"
                          >
                            <Download size={16} />
                            Tải xuống
                          </button>
                        </div>
                      </div>
                      <div className="p-12 sm:p-16 bg-white/[0.01] relative">
                        <div className="absolute inset-0 paper-texture opacity-[0.05] pointer-events-none" />
                        <div className="markdown-body prose prose-invert max-w-none relative">
                          <Markdown>{bookIntro}</Markdown>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {/* Analysis Section */}
                {analysis && (
                  <section className="library-card overflow-hidden group/result">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] min-h-[450px]">
                      <div className="p-12 bg-white/[0.03] flex flex-col justify-between border-r border-white/5 relative">
                        <div className="absolute inset-0 paper-texture opacity-[0.02] pointer-events-none" />
                        <div className="relative space-y-6">
                          <div className="w-16 h-1 bg-primary/40" />
                          <h2 className="text-4xl">Phân tích <br /><span className="italic text-primary/60">Chủ đề</span></h2>
                          <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.4em]">Mã lưu trữ: LIB-ANL-{Math.floor(Math.random() * 10000)}</p>
                        </div>
                        <div className="relative space-y-4">
                          <button 
                            onClick={() => copyToClipboard(analysis)}
                            className="w-full px-6 py-4 bg-white/10 border border-white/20 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-all flex items-center justify-center gap-3"
                          >
                            <Copy size={16} />
                            Sao chép nội dung
                          </button>
                          <button 
                            onClick={shareToFacebook}
                            className="w-full px-6 py-4 bg-[#1877F2]/10 border border-[#1877F2]/20 text-[#1877F2] rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-[#1877F2]/20 transition-all flex items-center justify-center gap-3"
                          >
                            <Facebook size={16} />
                            Chia sẻ Facebook
                          </button>
                          <button 
                            onClick={() => shareToNotebookLM(analysis)}
                            className="w-full px-6 py-4 bg-primary/10 border border-primary/20 text-primary rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-primary/20 transition-all flex items-center justify-center gap-3"
                          >
                            <ExternalLink size={16} />
                            NotebookLM Overview
                          </button>
                          <button 
                            onClick={() => {
                              const blob = new Blob([analysis], { type: 'text/plain' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `HanoiLibrary-Analysis-${bookInfo.title || 'Book'}.txt`;
                              a.click();
                            }}
                            className="w-full px-6 py-4 bg-white/5 border border-white/10 text-white/40 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:text-white hover:bg-white/10 transition-all flex items-center justify-center gap-3"
                          >
                            <Download size={16} />
                            Tải xuống bản ghi
                          </button>
                        </div>
                      </div>
                      <div className="p-12 sm:p-16 bg-white/[0.01] relative">
                        <div className="absolute inset-0 paper-texture opacity-[0.05] pointer-events-none" />
                        <div className="markdown-body prose prose-invert max-w-none relative">
                          <Markdown>{analysis}</Markdown>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {/* Key Points Section */}
                {keyPoints && (
                  <section className="library-card overflow-hidden group/result">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] min-h-[450px]">
                      <div className="p-12 bg-primary/5 flex flex-col justify-between border-r border-white/5 relative">
                        <div className="absolute inset-0 paper-texture opacity-[0.02] pointer-events-none" />
                        <div className="relative space-y-6">
                          <div className="w-16 h-1 bg-primary/40" />
                          <h2 className="text-4xl">Điểm nhấn <br /><span className="italic text-primary">Cốt lõi</span></h2>
                          <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.4em]">Hồ sơ Thư viện số</p>
                        </div>
                        <div className="relative space-y-4">
                          <button 
                            onClick={() => copyToClipboard(keyPoints)}
                            className="w-full px-6 py-4 bg-white/10 border border-white/20 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-all flex items-center justify-center gap-3"
                          >
                            <Copy size={16} />
                            Sao chép nội dung
                          </button>
                          <button 
                            onClick={() => generateGoogleTts(keyPoints, 'vi-VN-Wavenet-A', 'vi-VN')}
                            className="w-full px-6 py-4 bg-primary/10 border border-primary/20 text-primary rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-primary/20 transition-all flex items-center justify-center gap-3"
                          >
                            <Mic size={16} />
                            Tạo âm thanh (Google Cloud)
                          </button>
                          <button 
                            onClick={shareToFacebook}
                            className="w-full px-6 py-4 bg-[#1877F2]/10 border border-[#1877F2]/20 text-[#1877F2] rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-[#1877F2]/20 transition-all flex items-center justify-center gap-3"
                          >
                            <Facebook size={16} />
                            Chia sẻ Facebook
                          </button>
                          <button 
                            onClick={() => shareToNotebookLM(keyPoints)}
                          className="relative w-full px-6 py-4 bg-white/10 border border-white/20 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-all flex items-center justify-center gap-3"
                        >
                          <ExternalLink size={16} />
                          Tạo Audio Overview
                        </button>
                      </div>
                    </div>
                    <div className="p-12 sm:p-16 bg-white/[0.01] relative">
                        <div className="absolute inset-0 paper-texture opacity-[0.05] pointer-events-none" />
                        <div className="markdown-body prose prose-invert max-w-none relative">
                          <Markdown>{keyPoints}</Markdown>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {/* Summary Section */}
                {summary && (
                  <section className="library-card overflow-hidden group/result">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] min-h-[450px]">
                      <div className="p-12 bg-terracotta/10 flex flex-col justify-between border-r border-white/5 relative">
                        <div className="absolute inset-0 paper-texture opacity-[0.02] pointer-events-none" />
                        <div className="relative space-y-6">
                          <div className="w-16 h-1 bg-terracotta/40" />
                          <h2 className="text-4xl">Tóm tắt <br /><span className="italic text-terracotta">Tác phẩm</span></h2>
                          <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.4em]">Định dạng: {summaryType}</p>
                        </div>
                        <div className="relative space-y-4">
                          <button 
                            onClick={() => copyToClipboard(summary)}
                            className="w-full px-6 py-4 bg-white/10 border border-white/20 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-all flex items-center justify-center gap-3"
                          >
                            <Copy size={16} />
                            Sao chép nội dung
                          </button>
                          <button 
                            onClick={() => shareToNotebookLM(summary)}
                            className="w-full px-6 py-4 bg-terracotta text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-terracotta/80 transition-all flex items-center justify-center gap-3 shadow-xl shadow-terracotta/10"
                          >
                            <ExternalLink size={16} />
                            NotebookLM Overview
                          </button>
                          <button 
                            onClick={() => {
                              const blob = new Blob([summary], { type: 'text/plain' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `HanoiLibrary-Summary-${bookInfo.title || 'Book'}.txt`;
                              a.click();
                            }}
                            className="w-full px-6 py-4 bg-white/5 border border-white/10 text-white/40 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:text-white hover:bg-white/10 transition-all flex items-center justify-center gap-3"
                          >
                            <Download size={16} />
                            Tải xuống
                          </button>
                        </div>
                      </div>
                      <div className="p-12 sm:p-16 bg-white/[0.01] relative">
                        <div className="absolute inset-0 paper-texture opacity-[0.05] pointer-events-none" />
                        <div className="markdown-body prose prose-invert max-w-none relative">
                          <Markdown>{summary}</Markdown>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {/* Podcast Covers Section */}
                {podcastCovers.length > 0 && (
                  <section className="library-card overflow-hidden group/result">
                    <div className="px-10 py-10 border-b border-white/5 flex items-center justify-between bg-white/[0.02] relative">
                      <div className="absolute inset-0 paper-texture opacity-[0.02] pointer-events-none" />
                      <div className="flex items-center gap-6 relative">
                        <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary shrink-0 border border-primary/20 shadow-xl shadow-primary/5">
                          <Mic className="w-7 h-7" strokeWidth={1.5} />
                        </div>
                        <div>
                          <h3 className="font-commons font-bold text-[20px] text-white uppercase tracking-[0.3em]">Thiết kế bìa Podcast</h3>
                          <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.2em] mt-1">Nghệ thuật thị giác & Di sản văn hóa</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-10 sm:p-16 relative">
                      <div className="absolute inset-0 paper-texture opacity-[0.03] pointer-events-none" />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-12 sm:gap-16 relative">
                        {podcastCovers.map((cover, idx) => (
                          <motion.div 
                            key={idx}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: idx * 0.1 }}
                            className="group relative aspect-video rounded-[2rem] overflow-hidden shadow-2xl border border-white/10 ring-1 ring-white/5"
                          >
                            <img 
                              src={cover} 
                              alt={`Podcast Cover ${idx + 1}`} 
                              className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 flex flex-col justify-end p-8 gap-4">
                              <button 
                                onClick={shareToFacebook}
                                className="w-full py-4 bg-[#1877F2]/20 backdrop-blur-xl border border-[#1877F2]/30 rounded-xl text-white text-[11px] font-bold uppercase tracking-[0.2em] hover:bg-[#1877F2]/40 transition-all flex items-center justify-center gap-3"
                              >
                                <Facebook size={16} strokeWidth={1.5} />
                                Chia sẻ Facebook
                              </button>
                              <button 
                                onClick={() => shareToCanva(cover)}
                                className="w-full py-4 bg-white/10 backdrop-blur-xl border border-white/20 rounded-xl text-white text-[11px] font-bold uppercase tracking-[0.2em] hover:bg-white/20 transition-all flex items-center justify-center gap-3"
                              >
                                <ExternalLink size={16} strokeWidth={1.5} />
                                Mở trong Canva
                              </button>
                              <button 
                                onClick={() => {
                                  const a = document.createElement('a');
                                  a.href = cover;
                                  a.download = `HanoiLibrary-PodcastCover-${idx + 1}.png`;
                                  a.click();
                                }}
                                className="w-full py-4 bg-white/10 backdrop-blur-xl border border-white/20 rounded-xl text-white text-[11px] font-bold uppercase tracking-[0.2em] hover:bg-white/20 transition-all flex items-center justify-center gap-3"
                              >
                                <Download size={16} strokeWidth={1.5} />
                                Tải xuống thiết kế
                              </button>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                      <div className="mt-20 sm:mt-28 text-center max-w-xl mx-auto space-y-6 relative">
                        <div className="h-px w-24 bg-primary/20 mx-auto" />
                        <p className="font-serif italic text-2xl sm:text-4xl text-white/80 leading-relaxed">
                          "Gìn giữ văn hóa, <br className="sm:hidden" /> lan tỏa tri thức"
                        </p>
                        <div className="space-y-2">
                          <p className="text-[22px] font-commons font-bold uppercase tracking-[0.3em] text-primary">
                            TRUNG TÂM VĂN HÓA VÀ THƯ VIỆN HÀ NỘI
                          </p>
                          <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.4em] mt-4">
                            © Bản quyền Podcast thuộc về Trung tâm Văn hóa và Thư viện Hà Nội
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </motion.div>
            ) : (
              <div className="h-full min-h-[700px] flex flex-col items-center justify-center text-center p-10 sm:p-20 relative overflow-hidden">
                <div className="absolute inset-0 opacity-[0.02] pointer-events-none">
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-16 p-16">
                    {Array.from({ length: 32 }).map((_, i) => (
                      <Logo key={i} size={64} className="text-white" />
                    ))}
                  </div>
                </div>
                
                <motion.div 
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                  className="relative max-w-4xl space-y-16"
                >
                  <div className="flex justify-center">
                    <div className="w-32 h-32 bg-white/5 rounded-full flex items-center justify-center border border-white/10 backdrop-blur-xl shadow-2xl relative group">
                      <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                      <Logo size={56} className="relative z-10" />
                    </div>
                  </div>
                  <div className="space-y-8">
                    <h1 className="text-[48px] sm:text-[80px] leading-[1.1]">
                      Khám phá <span className="italic text-terracotta">Hồn Việt</span>,<br />
                      Nâng tầm <span className="italic text-primary">Tri thức</span>.
                    </h1>
                    
                    <p className="text-white/40 font-serif italic text-xl sm:text-3xl leading-relaxed max-w-3xl mx-auto">
                      "Trung tâm Văn hóa và Thư viện Hà Nội - Nơi di sản ngàn năm cộng hưởng cùng trí tuệ nhân tạo để kiến tạo tương lai văn hóa đọc."
                    </p>
                  </div>
                  
                  <div className="flex flex-wrap justify-center gap-12 sm:gap-20">
                    <div className="flex flex-col items-center gap-4 group">
                      <div className="w-16 h-16 rounded-full border border-white/10 flex items-center justify-center mb-2 group-hover:border-primary/40 transition-all duration-500 bg-white/5">
                        <BookOpen className="text-white/20 group-hover:text-primary transition-colors" size={24} strokeWidth={1} />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-white/20 group-hover:text-white/40 transition-colors">Kho lưu trữ số</span>
                    </div>
                    <div className="w-px h-20 bg-white/5 mx-4 hidden sm:block" />
                    <div className="flex flex-col items-center gap-4 group">
                      <div className="w-16 h-16 rounded-full border border-white/10 flex items-center justify-center mb-2 group-hover:border-primary/40 transition-all duration-500 bg-white/5">
                        <Mic className="text-white/20 group-hover:text-primary transition-colors" size={24} strokeWidth={1} />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-white/20 group-hover:text-white/40 transition-colors">Podcast Di sản</span>
                    </div>
                    <div className="w-px h-20 bg-white/5 mx-4 hidden sm:block" />
                    <div className="flex flex-col items-center gap-4 group">
                      <div className="w-16 h-16 rounded-full border border-white/10 flex items-center justify-center mb-2 group-hover:border-primary/40 transition-all duration-500 bg-white/5">
                        <ImageIcon className="text-white/20 group-hover:text-primary transition-colors" size={24} strokeWidth={1} />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-white/20 group-hover:text-white/40 transition-colors">Nghệ thuật AI</span>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>

      {/* Footer */}
      <footer className="bg-black/60 border-t border-white/5 py-24 sm:py-32 relative z-10 overflow-hidden">
        <div className="absolute inset-0 paper-texture opacity-[0.02] pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6 relative">
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr] gap-20 items-start">
            <div className="space-y-10">
              <div className="flex items-center gap-8">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center text-white/20 border border-white/10 overflow-hidden p-2 shadow-2xl">
                  <Logo size={32} />
                </div>
                <div className="space-y-1">
                  <p className="text-[24px] font-commons font-bold uppercase tracking-[0.2em] text-primary">TRUNG TÂM VĂN HÓA VÀ THƯ VIỆN HÀ NỘI</p>
                  <div className="flex items-center gap-3">
                    <div className="h-px w-6 bg-terracotta/40" />
                    <p className="text-[12px] text-terracotta tracking-[0.2em] font-serif italic font-medium uppercase">Gìn giữ & Phát huy Giá trị Văn hóa</p>
                  </div>
                </div>
              </div>
              <p className="text-white/30 font-serif italic text-lg max-w-md leading-relaxed">
                "Thư viện không chỉ là nơi lưu giữ những cuốn sách, mà còn là nơi nuôi dưỡng những tâm hồn và kiến tạo những giá trị văn hóa bền vững cho mai sau."
              </p>
            </div>
            
            <div className="space-y-8">
              <h4 className="text-[11px] font-bold uppercase tracking-[0.4em] text-white/60">Liên kết nhanh</h4>
              <nav className="flex flex-col gap-5">
                <a href="#" className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/30 hover:text-primary transition-all duration-300">Thư viện số</a>
                <a href="#" className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/30 hover:text-primary transition-all duration-300">Kho Podcast</a>
                <a href="#" className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/30 hover:text-primary transition-all duration-300">Sự kiện văn hóa</a>
                <a href="#" className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/30 hover:text-primary transition-all duration-300">Về chúng tôi</a>
              </nav>
            </div>

            <div className="space-y-8">
              <h4 className="text-[11px] font-bold uppercase tracking-[0.4em] text-white/60">Thông tin</h4>
              <div className="space-y-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/30 leading-loose">
                  Địa chỉ: 47 Bà Triệu, <br />Hoàn Kiếm, Hà Nội
                </p>
                <div className="h-px w-8 bg-white/10" />
                <p className="text-[10px] text-white/20 font-bold uppercase tracking-[0.2em]">© 2026 TRUNG TÂM VĂN HÓA VÀ THƯ VIỆN HÀ NỘI</p>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* Floating Action Button - Generate All */}
      <div className="fixed bottom-12 right-12 z-50">
        <button 
          onClick={generateAll}
          disabled={loading || !bookInfo.title}
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border border-white/20 bg-white/5 backdrop-blur-xl flex items-center justify-center text-white hover:bg-white/10 transition-all group shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed"
          title="Phân tích toàn diện"
        >
          {loading ? (
            <Loader2 className="animate-spin" size={32} strokeWidth={1} />
          ) : (
            <ArrowRight size={32} strokeWidth={1} className="group-hover:translate-x-1 transition-transform" />
          )}
        </button>
      </div>
    </div>
  );
}
