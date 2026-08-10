package io.umbra.browser

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class TabAdapter(
    private val tabs: List<Tab>,
    private val onSelect: (Int) -> Unit,
    private val onClose: (Int) -> Unit,
) : RecyclerView.Adapter<TabAdapter.Holder>() {

    class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val title: TextView = view.findViewById(R.id.tabTitle)
        val url: TextView = view.findViewById(R.id.tabUrl)
        val close: ImageButton = view.findViewById(R.id.tabClose)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_tab, parent, false)
        return Holder(view)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val tab = tabs[position]
        holder.title.text = tab.title.ifEmpty { holder.itemView.context.getString(R.string.new_tab) }
        holder.url.text = Urls.pretty(tab.url)
        holder.itemView.setOnClickListener { onSelect(holder.bindingAdapterPosition) }
        holder.close.setOnClickListener { onClose(holder.bindingAdapterPosition) }
    }

    override fun getItemCount(): Int = tabs.size
}
