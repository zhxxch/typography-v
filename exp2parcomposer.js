var CanvasEl = document.querySelector("canvas");
CanvasEl.width = 600;
CanvasEl.height = 1200;
var CanvasClear = function () {
	CanvasContext.clearRect(0, 0, CanvasContext.canvas.width, CanvasContext.canvas.height);
}
var CanvasContext = CanvasEl.getContext("2d");
CanvasContext.textAlign = "left";
CanvasContext.lineWidth = 0.5
var AdvWidthCache=new Float32Array(0xffff);
function ClearAdvWCache(){
	AdvWidthCache.fill(-1);
}
ClearAdvWCache();
function MeasureText(str, CanvasCtx){
	const codepoint = str.charCodeAt(0);
	if(codepoint>AdvWidthCache.length){
		return CanvasCtx.measureText(str).width;
	}
	const cached = AdvWidthCache[codepoint];
	if(cached>0){
		return cached;
	}
	const measured = CanvasCtx.measureText(str).width;
	AdvWidthCache[codepoint] = measured;
	return measured;
}

function displaystat(ttl_time, format_time, composer_time, numline, numlist) {
	const round = x => Math.round(x * 100) / 100;
	const settext = (x, v) => document.querySelector(x).innerText = v.toString();
	settext("#timer-ttl", round(ttl_time));
	settext("#timer-fmt", round(format_time));
	settext("#timer-cmp", round(composer_time));
	settext("#timer-fps", round(1000 / ttl_time));
	settext("#memstat-lines", numline);
	settext("#memstat-hlist", numlist);
}
function displayerr(msg) {
	document.querySelector("#warning-container").innerText = msg;
}
var MEPCmem = new WebAssembly.Memory({ initial: 20 });
function ComposerMemLayout(MepcInst, MepcMem, reserves = { "format": 20, "formatlist": 100, "linespec": 100 }) {
	const memsize = MepcMem.buffer.byteLength;
	const baseptr = MepcInst.exports.__heap_base.value;
	const Heapsize = memsize - baseptr;
	const FormatSize = MepcInst.exports.sizeof_formats(reserves.format);
	const FormatPtr = baseptr;
	const FormatListReserve = MepcInst.exports.sizeof_hlist(reserves.formatlist);
	const FormatListPtr = FormatPtr + FormatSize;
	const LinesSpecSize = reserves.linespec * 4;
	const LinesSpecPtr = FormatListPtr + FormatListReserve;
	const GenHlistStatResv = MepcInst.exports.sizeof_hlist(1);
	const GenHlistStatPtr = LinesSpecPtr + LinesSpecSize;
	const ListsReserve = Heapsize - LinesSpecSize - FormatListReserve - FormatSize - GenHlistStatResv;
	const MaxListLen = Math.floor((ListsReserve / MepcInst.exports.sizeof_hlist(1)) / 4);
	const ListSize = MepcInst.exports.sizeof_hlist(MaxListLen);
	const ListPtr = GenHlistStatPtr + GenHlistStatResv;
	const HorizonPtr = ListPtr + ListSize;
	const MaxHorizonLen = MaxListLen;
	const OptimsPtr = HorizonPtr + ListSize;
	const MaxOptimsLen = MaxListLen;
	const PositionListPtr = OptimsPtr + ListSize;
	const MaxPositionLen = MaxListLen;
	return { "heapbase": baseptr, "heapsize": Heapsize, "formatsize": FormatSize, "formatptr": baseptr, "formatlistsize": FormatListReserve, "formatlistptr": FormatListPtr, "maxlines": reserves.linespec, "linespecsize": LinesSpecSize, "linespecptr": LinesSpecPtr, "genhliststatsize": GenHlistStatResv, "genhliststatptr": GenHlistStatPtr, "listsize": ListSize, "maxlistlen": MaxListLen, "listptr": ListPtr, "horizonptr": HorizonPtr, "optimsptr": OptimsPtr, "positionlistptr": PositionListPtr };
}
function gen_hlist(str, MepcMemLayout, MepcInst, CanvasCtx) {
	var HlistIter = MepcInst.exports.ME_gen_hlist_init(MepcMemLayout.listptr, MepcMemLayout.maxlistlen, MepcMemLayout.formatptr, MepcMemLayout.genhliststatptr);
	for (var i = 0; i < str.length; i++) {
		const iter_offset = MepcInst.exports.sizeof_hlist(HlistIter);
		const adv_width = MeasureText(str[i], CanvasCtx);
		/*
		const kern = CanvasCtx.measureText(str.slice(0, i + 1)).width - CanvasCtx.measureText(str.slice(0, i)).width - adv_width;
		*/
		HlistIter += MepcInst.exports.ME_gen_hlist_iter(MepcMemLayout.listptr + iter_offset, MepcMemLayout.maxlistlen - HlistIter, adv_width, 0,
			MepcInst.exports.ME_uctype(str.charCodeAt(i), 0), MepcMemLayout.formatptr, MepcMemLayout.genhliststatptr);
	}
	const iter_offset = MepcInst.exports.sizeof_formats(HlistIter);
	HlistIter += MepcInst.exports.ME_gen_hlist_complete(MepcMemLayout.listptr + iter_offset, MepcMemLayout.maxlistlen - HlistIter, MepcMemLayout.formatptr);
	if (HlistIter >= MepcMemLayout.maxlistlen) {
		displayerr("水平列表溢出内存");
		throw ("gen_hlist OOM");
	}
	return HlistIter;
}
function compose_lines(ListLen, MepcMemLayout, MepcInst) {
	const NodesHorizonsSize = MepcInst.exports.ME_gen_horizons(MepcMemLayout.horizonptr, MepcMemLayout.maxlistlen, MepcMemLayout.listptr, ListLen, MepcMemLayout.linespecptr, MepcMemLayout.maxlines);
	if (MepcInst.exports.ME_overfull(MepcMemLayout.horizonptr, NodesHorizonsSize - 1)) {
		displayerr("文字溢出");
	}
	if (MepcInst.exports.ME_underfull(MepcMemLayout.horizonptr, NodesHorizonsSize - 1)) {
		displayerr("文字不足以填充整行");
	}
	if (NodesHorizonsSize > MepcMemLayout.maxlistlen) {
		displayerr("断行内存溢出")
		throw ("HorizonsOOM");
	}
	const NumLines = MepcInst.exports.ME_minimise(MepcMemLayout.optimsptr, MepcMemLayout.maxlines, MepcMemLayout.horizonptr, NodesHorizonsSize, 100000);
	if (NumLines > MepcMemLayout.maxlines) {
		displayerr("超过最大行数限制");
		throw ("LINES_OVERFULL");
	}
	MepcInst.exports.ME_position(MepcMemLayout.listptr, ListLen, MepcMemLayout.optimsptr + MepcInst.exports.sizeof_hlist(MepcMemLayout.maxlines - NumLines), MepcMemLayout.positionlistptr);
	return NumLines;
}
function composer_print(str, NumLines, ListLen, MepcMemLayout, MepcMem, MepcInst, CanvasCtx, LineSpecArr) {

	var line_spec = LineSpecArr[0];
	const MEfn = ["isbox", "width", "pen_position", "ispenalty", "ispenalty_neginf", "penalty", "penalty_flag"].reduce((obj, fn_name) => Object.assign(obj, {
		[fn_name]: function (i) {
			return MepcInst.exports[fn_name](MepcMemLayout.positionlistptr + MepcInst.exports.sizeof_hlist(i));
		}
	}), {});

	for (var li = 0, si = 0, line_iter = 0; li < ListLen; li++) {
		if (MEfn.isbox(li) && MEfn.width(li) > 0) {
			while (MeasureText(str[si], CanvasCtx) <= 0) {
				si++;
			}
			while (MepcInst.exports.uctype_isblank(MepcInst.exports.ME_uctype(str.charCodeAt(si), 0))) {
				si++;
			}
			CanvasCtx.fillText(str[si], line_spec.x + MEfn.pen_position(li), line_spec.y + line_spec.height);
			si++;
		} else if (MEfn.ispenalty(li) && MEfn.ispenalty_neginf(li)) {
			if (MEfn.penalty_flag(li) > 0) {
				CanvasCtx.fillText("-", line_spec.x + MEfn.penalty_flag(li), line_spec.y + line_spec.height);
			}
			line_iter++;
			line_spec = LineSpecArr[line_iter];
		}
	}
}
function gen_linespec(defaultwidth, MepcMemLayout, MepcMem, MepcInst, specsarr = []) {
	var LinesMemView = new Float32Array(MepcMem.buffer, MepcMemLayout.linespecptr);
	for (var i = 0; i < MepcMemLayout.maxlines; i++) {
		if (i < specsarr.length) {
			LinesMemView[i] = specsarr[i];
		} else {
			LinesMemView[i] = defaultwidth;
		}
	}
}
function gen_format(formatobj, MepcMemLayout, MepcInst, CanvasCtx) {
	const FormatPtr = MepcMemLayout.formatptr;
	const FormatListPtr = MepcMemLayout.formatlistptr;
	const FormatListSize = MepcMemLayout.formatlistsize;
	const fndict = {
		"hbox": function (ptr, spec) { MepcInst.exports.gen_box(ptr, spec.width); return MepcInst.exports.sizeof_hlist(1); },
		"hskip": function (ptr, spec) { MepcInst.exports.gen_glue(ptr, spec.width, spec.stretch, spec.shrink); return MepcInst.exports.sizeof_hlist(1); }, "penalty": function (ptr, spec) { MepcInst.exports.gen_penalty(ptr, spec.width, spec.penalty, spec.flag); return MepcInst.exports.sizeof_hlist(1); }
	};
	formatobj["hyphenpenalty"] = [{ "type": "hskip", "spec": { "width": MeasureText("-", CanvasCtx), "penalty": 9999, "flag": 1 } }];
	var formatlist_iter = FormatListPtr;
	for (const p in formatobj) {
		const formatarr = formatobj[p];
		const formatlisthead_ptr = formatlist_iter;
		for (var i = 0; i < formatarr.length; i++) {
			formatlist_iter += fndict[formatarr[i].type](formatlist_iter, formatarr[i].spec);
			if (formatlist_iter - FormatListPtr >= FormatListSize) {
				displayerr("格式溢出内存");
				throw ("Format list OOM");
			}
		}
		MepcInst.exports["format_" + p.toUpperCase()](FormatPtr, formatlisthead_ptr, formatarr.length);
	}
}
var MEPCwasm = fetch("mepc.wasm").then(Response => Response.arrayBuffer()).then(buffer => WebAssembly.compile(buffer)).then(module => {
	return WebAssembly.instantiate(module, { env: { memory: MEPCmem, console_logi32: x => console.log(x), console_logf32: x => console.log(x), console_logp: x => console.log(x) } });
}).then(MEPCinst => {
	/*console.log(MEPCinst.exports);*/
	const MemLayout = ComposerMemLayout(MEPCinst, MEPCmem);
	/*console.log(MemLayout);*/
	function update_format(ev = {}) {
		const formatobj = ControlSeq2Obj(ControlSeqInput());
		gen_format(formatobj, MemLayout, MEPCinst, CanvasContext);
		gen_linespec(Number(document.querySelector("#linewidth-input").value), MemLayout, MEPCmem, MEPCinst);
		const font_str = document.querySelector("#fontsize-input").value + "px " + document.querySelector("#fontname-input").value;
		CanvasContext.font = font_str;
	}
	async function compose(ev={}) {
		displayerr("");
		const t0 = performance.now();
		var mview = new Int32Array(MEPCmem.buffer, MEPCinst.exports.__heap_base);
		mview.fill(0);
		update_format();
		t1_format = performance.now();
		const input_text = document.querySelector("#par-input").value;
		const ListLen = gen_hlist(input_text, MemLayout, MEPCinst, CanvasContext);
		const NumLines = compose_lines(ListLen, MemLayout, MEPCinst);
		t2_compose = performance.now();
		const line_height = Number(document.querySelector("#lineheight-input").value);
		const line_width = Number(document.querySelector("#linewidth-input").value);
		var line_specs = (new Array(100)).fill(0).map((v, i) => { return { "x": 25, "y": (line_height / 2 + line_height * i), "height": line_height }; });
		CanvasClear();
		CanvasContext.strokeRect(-line_specs[0].x, -line_specs[0].height, line_specs[0].x * 2, line_specs[0].height * 1.5);
		CanvasContext.strokeRect(line_specs[0].x + line_width, -line_specs[0].height, line_specs[0].x + line_width + CanvasContext.canvas.width, line_specs[0].height * 1.5);
		composer_print(input_text, NumLines, ListLen, MemLayout, MEPCmem, MEPCinst, CanvasContext, line_specs);
		t3_fin = performance.now();
		displaystat(t3_fin - t0, t1_format - t0, t2_compose - t1_format, NumLines, ListLen);
	}
	["#format-input", "#fontname-input", "#fontsize-input", "#linewidth-input", "#lineheight-input"].forEach(x => document.querySelector(x).addEventListener("input", ev=>{ClearAdvWCache();compose();}));
	document.querySelector("#start-composer").addEventListener("click", compose);
	["#par-input"].forEach(x => document.querySelector(x).addEventListener("input", compose));
	compose();
});

function ControlSeqInput() {
	return document.querySelector("#format-input").value.replace(/\{\}/g, "");
}
function ControlSeq2Obj(cseq, format_obj = {}) {
	if (cseq.length == 0) return format_obj;
	const primitive_name = cseq.slice(cseq.indexOf("\\") + 1, cseq.match(/[={]/).index);
	if (cseq.indexOf("=") == cseq.match(/[={]/).index) {
		const cseq_glue = cseq.slice(cseq.indexOf("=") + 1);
		format_obj[primitive_name] = ControlSeq2Array(
			"\\hskip" + cseq_glue.slice(0, cseq_glue.match(/\\|$/).index));
		const cseq_r = cseq.slice(cseq.indexOf("\\") + 1);
		return ControlSeq2Obj(cseq_r.slice(cseq_r.match(/\\|$/).index), format_obj);
	} else {
		format_obj[primitive_name] = ControlSeq2Array(
			cseq.slice(cseq.indexOf("{"), cseq.indexOf("}"))
		);
	}
	return ControlSeq2Obj(cseq.slice(cseq.indexOf("}") + 1), format_obj);
}
function ControlSeq2Array(cseq) {
	return cseq.split("\\").slice(1)
		.map(str => { return str.match(/penalty|hskip|hbox/); })
		.map(match_res => { return { "type": match_res[0], "spec": match_res.input.slice(match_res[0].length) }; })
		.map(node_literal => {
			return {
				"type": node_literal.type,
				"spec": {
					"penalty": function (str) { return { "penalty": Number(str), "width": 0, "flag": 0 }; },
					"hbox": function (str) { return { "width": 0 }; },
					"hskip": function (str) {
						const glue_spec = str.split(/plus|minus/);
						return { "width": Number(glue_spec[0]) | 0, "stretch": Number(glue_spec[1]) | 0, "shrink": Number(glue_spec[2]) | 0 };
					}
				}[node_literal.type](node_literal.spec)
			};
		}
		);
}